import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { openSpeakerAudio, openSpeakerConfig } from '../bridge/openspeaker-speech.mjs'
import { morningDate } from '../bridge/morning-briefing.mjs'

const date = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) || morningDate()
if (date !== morningDate()) throw new Error('Não gerar áudio de outro dia ou recuperar briefings antigos.')
const folder = join(import.meta.dirname, '..', '.local', 'briefings', date)
const inputIndex = process.argv.indexOf('--input')
if (inputIndex >= 0 && !process.argv.includes('--dry-run')) throw new Error('Arquivo de teste permitido somente com --dry-run.')
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : join(folder, 'briefing.txt')
const text = (await readFile(inputPath, 'utf8')).trim()
if (!text || text.length > 10000 || text.split(/\s+/).length > 500) throw new Error('O briefing precisa ter até 500 palavras e 10.000 caracteres, sem truncar frases.')
const statePath = join(folder, 'audio-state.json')
if (!process.argv.includes('--dry-run')) await mkdir(folder, { recursive: true })
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ date, characters: text.length, words: text.split(/\s+/).length, paidRequests: 0, configured: Boolean(openSpeakerConfig()?.enabled) }))
} else if (!openSpeakerConfig()?.enabled) {
  await writeFile(statePath, JSON.stringify({ status: 'connection_pending', date, message: 'Texto pronto; aguardando conexão da conta OpenSpeaker.' }, null, 2))
  console.log('Briefing salvo em texto. OpenSpeaker ainda não conectado; nenhuma geração cobrada.')
} else {
  await writeFile(statePath, JSON.stringify({ status: 'generating', date, startedAt: new Date().toISOString() }))
  try {
    const result = await openSpeakerAudio(text)
    await writeFile(join(folder, 'briefing.audio'), result.audio)
    await writeFile(statePath, JSON.stringify({ status: 'ready', date, taskId: result.taskId, creditCost: result.creditCost, cached: result.cached, contentType: result.contentType, readyAt: new Date().toISOString() }, null, 2))
    console.log(JSON.stringify({ status: 'ready', date, characters: text.length, creditCost: result.creditCost, cached: result.cached }))
  } catch (error) {
    await writeFile(statePath, JSON.stringify({ status: 'error', date, message: error.message }, null, 2))
    throw error
  }
}
