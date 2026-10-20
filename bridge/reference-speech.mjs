import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const root = join(import.meta.dirname, '..')
const pending = new Map()
const cache = new Map()
let worker, serial = 0
export const referenceEnabled = () => existsSync(join(root, '.local', 'voice-reference', 'enabled.json'))
export function referenceSpeech(text) {
  if (cache.has(text)) return Promise.resolve(cache.get(text))
  if (!worker) {
    worker = spawn(join(root, '.voice-venv', 'Scripts', 'python.exe'), [join(root, 'scripts', 'reference-voice.py'), '--serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    createInterface({ input: worker.stdout }).on('line', line => {
      try {
        const data = JSON.parse(line), call = pending.get(data.id)
        if (!call) return
        clearTimeout(call.timer); pending.delete(data.id)
        if (data.error) call.reject(new Error(data.error))
        else {
          const audio = Buffer.from(data.audio, 'base64')
          if (call.text.length < 300) { cache.set(call.text, audio); if (cache.size > 32) cache.delete(cache.keys().next().value) }
          call.resolve(audio)
        }
      } catch { /* Model diagnostics belong on stderr. */ }
    })
    worker.stderr.on('data', data => process.stderr.write(data))
    worker.stdin.on('error', () => {})
    const fail = () => {
      worker = undefined
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Conversão de voz interrompida.')) }
      pending.clear()
    }
    worker.on('error', fail); worker.on('exit', fail)
  }
  return new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); worker?.kill(); reject(new Error('Conversão de voz demorou.')) }, 90000)
    pending.set(id, { resolve, reject, timer, text })
    worker.stdin.write(JSON.stringify({ id, text: String(text).slice(0, 3000) }) + '\n')
  })
}
process.on('exit', () => worker?.kill())
