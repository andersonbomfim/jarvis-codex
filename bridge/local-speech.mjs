import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const root = join(import.meta.dirname, '..')
let child, starting, sequence = 0
const pending = new Map()
export const localSpeechAvailable = () => process.env.JARVIS_LOCAL_STT !== '0' && existsSync(join(root, '.local/models/whisper-base/model.bin'))

export function closeLocalSpeech() { child?.kill() }
process.on('exit', closeLocalSpeech)

async function ready() {
  if (starting) return starting
  starting = new Promise((resolve, reject) => {
    child = spawn(join(root, '.venv/Scripts/python.exe'), ['-u', join(root, 'scripts/local-speech.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const bootTimer = setTimeout(() => { child?.kill(); reject(new Error('Reconhecimento local não iniciou.')) }, 60000)
    const fail = error => {
      clearTimeout(bootTimer); starting = null; reject(error)
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
      pending.clear()
    }
    child.on('error', fail)
    child.on('exit', () => fail(new Error('Reconhecimento local parou.')))
    child.stdin.on('error', () => {})
    // Model diagnostics contain no user audio or transcript.
    child.stderr.on('data', bytes => console.warn('[speech]', bytes.toString().slice(-500)))
    createInterface({ input: child.stdout }).on('line', line => {
      let event; try { event = JSON.parse(line) } catch { return }
      if (event.ready) { clearTimeout(bootTimer); resolve(); return }
      const item = pending.get(event.id)
      if (!item) return
      pending.delete(event.id); clearTimeout(item.timer)
      if (event.error) item.reject(new Error(event.error)); else item.resolve(event.text || '')
    })
  })
  return starting
}

export async function localTranscribe(audio) {
  if (audio.length > 5 * 1024 * 1024) throw new Error('Trecho de voz muito longo.')
  await ready()
  if (pending.size >= 3) throw new Error('Aguarde a transcrição anterior.')
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('A transcrição demorou demais.')); closeLocalSpeech() }, 45000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, audio: audio.toString('base64') }) + '\n')
  })
}

export function warmLocalSpeech() { if (localSpeechAvailable()) void ready().catch(e => console.warn('[speech]', e.message)) }
