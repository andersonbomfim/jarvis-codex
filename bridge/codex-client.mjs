import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function findCodex() {
  if (process.env.JARVIS_CODEX_PATH && existsSync(process.env.JARVIS_CODEX_PATH)) return process.env.JARVIS_CODEX_PATH
  if (process.platform !== 'win32') return 'codex'
  const result = spawnSync('where.exe', ['codex.exe'], { encoding: 'utf8', windowsHide: true })
  const found = result.stdout?.trim().split(/\r?\n/).find(p => existsSync(p))
  if (found) return found
  const root = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin')
  if (existsSync(root)) {
    const paths = readdirSync(root).map(p => join(root, p, 'codex.exe')).filter(existsSync)
    if (paths.length) return paths.at(-1)
  }
  throw new Error('Codex não encontrado neste computador.')
}

export class CodexClient {
  constructor() {
    this.pending = new Map()
    this.listeners = new Set()
    this.handlers = new Map()
    this.seq = 0
    this.log = ''
    this.child = spawn(findCodex(), ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.child.stderr.on('data', b => { this.log = (this.log + b).slice(-6000) })
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)) } catch (e) { console.error('[codex] protocolo:', e.message) }
    })
    this.child.on('error', e => this.fail(e))
    this.child.on('exit', () => this.fail(new Error('A conexão local com o Codex foi encerrada.')))
    this.ready = this.request('initialize', {
      clientInfo: { name: 'jarvis_local', title: 'Jarvis', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }).then(() => this.send({ method: 'initialized', params: {} }))
  }
  send(value) { if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(value) + '\n') }
  request(method, params = {}, timeoutMs = 120000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex demorou a responder: ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, method, params })
    })
  }
  async receive(msg) {
    if (msg.id !== undefined && !msg.method) {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id); clearTimeout(entry.timer)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
      return
    }
    if (msg.id !== undefined && msg.method) {
      const handler = this.handlers.get(msg.params?.threadId)
      try {
        if (!handler) throw new Error('Esta sessão não está mais aberta.')
        const result = await handler(msg.method, msg.params)
        this.send({ id: msg.id, result })
      } catch (err) {
        this.send({ id: msg.id, error: { code: -32603, message: err.message } })
      }
      return
    }
    for (const listener of this.listeners) listener(msg)
  }
  fail(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
    for (const listener of this.listeners) listener({ method: 'jarvis/disconnected', params: { message: error.message } })
  }
  close() { this.child.kill() }
}

let shared
export function codexClient() { return shared ??= new CodexClient() }
export function closeCodex() { shared?.close() }
