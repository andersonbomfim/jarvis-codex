import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { speechText } from '../shared/speech-text.mjs'

const local = join(import.meta.dirname, '..', '.local')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = value => createHash('sha256').update(value).digest('hex')

export function openSpeakerConfig() {
  try { return JSON.parse(readFileSync(join(local, 'openspeaker.json'), 'utf8').replace(/^\uFEFF/, '')) }
  catch { return null }
}

function configuredKey() {
  if (process.env.OPENSPEAKER_API_KEY) return process.env.OPENSPEAKER_API_KEY.trim()
  try { return readFileSync(join(local, 'openspeaker-key.txt'), 'utf8').trim() }
  catch { return '' }
}

export const openSpeakerEnabled = () => Boolean(openSpeakerConfig()?.fixedVoiceEnabled || openSpeakerConfig()?.enabled)

export function audioMime(bytes) {
  if (bytes.length > 44 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav'
  if (bytes.length > 3 && (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'audio/mpeg'
  if (bytes.length > 4 && bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg'
  throw new Error('OpenSpeaker retornou um arquivo sem formato de áudio reconhecido.')
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export function createOpenSpeakerClient({ apiKey, voiceId, speed = 1, apiBase = 'https://api.openspeaker.ai', cacheDir = join(local, 'openspeaker-cache'), fetchImpl = fetch, now = Date.now, wait = delay }) {
  if (!apiKey || !voiceId) throw new Error('Conecte a conta OpenSpeaker e selecione sua voz clonada.')
  if (!/^clone_\S+$/.test(voiceId)) throw new Error('Selecione o identificador clone_ da voz aprovada no OpenSpeaker.')
  const pending = new Map()
  const headers = { 'xi-api-key': apiKey }
  if (!['https://api.openspeaker.ai', 'https://api.ai33.pro'].includes(apiBase)) throw new Error('Endereço da API OpenSpeaker não reconhecido.')
  const api = apiBase
  async function request(path, options = {}) {
    const response = await fetchImpl(api + path, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      const error = new Error(`OpenSpeaker: HTTP ${response.status}.`)
      error.status = response.status
      throw error
    }
    return response.json()
  }
  async function recoverSubmission(state, input) {
    // A gateway error may occur after credits were reserved. Reconcile by
    // exact text, voice and submission time; never send a second POST to find out.
    try {
      const list = await request('/v1/tasks?page=1&limit=20')
      const started = Date.parse(state.startedAt)
      const candidates = (list.data || []).filter(task => {
        const voice = task.metadata?.v3?.raw_voice_id || task.voice_id || task.metadata?.voice_id
        const elapsed = Date.parse(task.created_at) - started
        return voice === voiceId && elapsed >= -5000 && elapsed <= 120000 &&
          (task.text === input || (task.text_truncated === true && typeof task.text === 'string' && input.startsWith(task.text)))
      })
      if (!candidates.length || candidates.length > 3) return null
      const matches = []
      for (const task of candidates) {
        const full = task.text_truncated ? await request('/v1/task/' + encodeURIComponent(task.id) + '/full') : task
        if (full.text === input && typeof task.id === 'string' && task.id) matches.push(task)
      }
      if (matches.length !== 1) return null
      return { ...state, status: 'doing', taskId: matches[0].id, recoveredAt: new Date(now()).toISOString() }
    } catch { return null }
  }
  async function generate(text) {
    const input = speechText(text)
    if (!input || input.length > 10000) throw new Error('O texto para voz deve ter entre 1 e 10.000 caracteres.')
    const key = sha(JSON.stringify(['openspeaker-v3', api, voiceId, speed, input]))
    if (pending.has(key)) return pending.get(key)
    const run = (async () => {
      await mkdir(cacheDir, { recursive: true })
      const audioPath = join(cacheDir, key + '.audio')
      const statePath = join(cacheDir, key + '.json')
      const lockPath = join(cacheDir, key + '.lock')
      const lockDeadline = now() + 20 * 60 * 1000
      let lock
      while (!lock) {
        try { lock = await open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ pid: process.pid })) }
        catch (error) {
          if (error.code !== 'EEXIST') throw error
          let holder
          try { holder = await readJson(lockPath) } catch { /* The owner may still be writing its PID. */ }
          if (holder?.pid) {
            try { process.kill(holder.pid, 0) }
            catch (probe) { if (probe.code === 'ESRCH') { await unlink(lockPath).catch(() => {}); continue } }
          }
          if (now() >= lockDeadline) throw new Error('Outra geração do mesmo texto continua em andamento; não houve uma nova cobrança.')
          await wait(2000)
        }
      }
      try {
      let state = await readJson(statePath)
      if (state?.status === 'done') {
        try {
          const audio = await readFile(audioPath)
          return { ...state, audio, contentType: audioMime(audio), cached: true }
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      if (!state?.taskId && ['submitting', 'uncertain'].includes(state?.status)) {
        const recovered = await recoverSubmission(state, input)
        if (!recovered) throw new Error('A confirmação do envio anterior falhou. Confira o histórico do OpenSpeaker antes de reenviar e gastar créditos novamente.')
        state = recovered
        await writeFile(statePath, JSON.stringify(state, null, 2))
      }
      if (!state?.taskId) {
        state = { status: 'submitting', voiceId, characters: input.length, startedAt: new Date(now()).toISOString() }
        await writeFile(statePath, JSON.stringify(state, null, 2))
        const body = new FormData()
        body.set('text', input); body.set('voice_id', voiceId); body.set('speed', String(speed)); body.set('with_transcript', 'false')
        let accepted, submissionError
        try { accepted = await request('/v3/text-to-speech', { method: 'POST', body }) }
        catch (error) { submissionError = error }
        if (!accepted?.success || !accepted.task_id) {
          state.status = submissionError?.status >= 400 && submissionError?.status < 500 ? 'rejected' : 'uncertain'
          await writeFile(statePath, JSON.stringify(state, null, 2))
          const recovered = state.status === 'uncertain' ? await recoverSubmission(state, input) : null
          if (!recovered) throw submissionError || new Error('OpenSpeaker não confirmou o identificador da tarefa; não houve reenvio automático.')
          state = recovered
        } else {
          state = { ...state, status: 'doing', taskId: accepted.task_id }
        }
        await writeFile(statePath, JSON.stringify(state, null, 2))
      }
      const deadline = now() + 20 * 60 * 1000
      let pollingErrors = 0
      while (now() < deadline) {
        let task
        try {
          task = await request('/v1/task/' + encodeURIComponent(state.taskId))
          pollingErrors = 0
        } catch (error) {
          if ((!error.status || error.status === 429 || error.status >= 500) && ++pollingErrors <= 6) {
            await wait(Math.min(15000, 2000 * pollingErrors))
            continue
          }
          throw error
        }
        if (task.status === 'error') {
          await writeFile(statePath, JSON.stringify({ ...state, status: 'error' }, null, 2))
          throw new Error('A tarefa de voz falhou no OpenSpeaker. Consulte seu histórico; não foi criada uma segunda tarefa.')
        }
        if (task.status === 'done') {
          const url = new URL(task.metadata?.audio_url)
          if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Endereço de áudio inválido retornado pelo OpenSpeaker.')
          // CDN downloads receive no account credential.
          const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(60000) })
          if (!response.ok) throw new Error(`Download da voz: HTTP ${response.status}.`)
          const chunks = []; let size = 0
          for await (const chunk of response.body) {
            size += chunk.length
            if (size > 20 * 1024 * 1024) throw new Error('Áudio maior que o limite de 20 MB.')
            chunks.push(chunk)
          }
          const audio = Buffer.concat(chunks)
          const contentType = audioMime(audio)
          state = { ...state, status: 'done', contentType, creditCost: task.credit_cost ?? null, finishedAt: new Date(now()).toISOString() }
          await writeFile(audioPath, audio)
          await writeFile(statePath, JSON.stringify(state, null, 2))
          return { ...state, audio, cached: false }
        }
        await wait(2000)
      }
      throw new Error('O OpenSpeaker ainda está gerando. O identificador foi salvo para consultar sem pagar outra geração.')
      } finally { await lock.close(); await unlink(lockPath).catch(() => {}) }
    })()
    pending.set(key, run)
    try { return await run } finally { pending.delete(key) }
  }
  return { generate }
}

let active
export async function openSpeakerAudio(text) {
  const config = openSpeakerConfig()
  if(!config?.enabled)throw Error('Geração de voz nova está desativada. Use as 41 gravações incluídas.')
  const apiKey = configuredKey()
  const identity = sha(JSON.stringify([apiKey, config?.voiceId, config?.speed || 1, config?.apiBase]))
  if (active?.identity !== identity) active = { identity, client: createOpenSpeakerClient({ apiKey, voiceId: config?.voiceId, speed: config?.speed || 1, apiBase: config?.apiBase }) }
  return active.client.generate(text)
}

export async function openSpeakerSpeech(text) { return (await openSpeakerAudio(text)).audio }
