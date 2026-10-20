import { mkdir, readdir, stat, readFile, writeFile, realpath } from 'node:fs/promises'
import { join, basename, extname, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cpus, freemem, totalmem, uptime } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './local-tools.mjs'

const exec = promisify(execFile)
const root = join(import.meta.dirname, '..', '.local')
const outputs = join(root, 'outputs')
const uploads = join(root, 'uploads')
await Promise.all([mkdir(outputs, { recursive: true }), mkdir(uploads, { recursive: true })])
const json = (res, cors, status, value) => { res.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
let previous = cpus()
let processorPercent = 0
const timer = setInterval(() => {
  const now = cpus(); let busy = 0, all = 0
  now.forEach((cpu, i) => {
    if (!previous[i]) return
    const delta = Object.keys(cpu.times).reduce((sum, key) => sum + cpu.times[key] - previous[i].times[key], 0)
    all += delta; busy += delta - (cpu.times.idle - previous[i].times.idle)
  })
  processorPercent = all ? Math.round(busy / all * 100) : 0
  previous = now
}, 2000)
timer.unref()

export async function workspaceRoute(req, res, cors, allowed) {
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/status') {
    json(res, cors, 200, { cpu: cpus()[0]?.model.trim(), cores: cpus().length, cpuPercent: processorPercent, ramTotal: totalmem(), ramUsed: totalmem() - freemem(), uptime: uptime(), platform: process.platform })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/outputs') {
    const entries = await readdir(outputs, { withFileTypes: true })
    const files = await Promise.all(entries.filter(e => e.isFile()).slice(-100).map(async e => { const info = await stat(join(outputs, e.name)); return { name: e.name, size: info.size, modified: info.mtime.toISOString() } }))
    json(res, cors, 200, files.sort((a, b) => b.modified.localeCompare(a.modified)))
    return true
  }
  if (req.method === 'GET' && url.pathname === '/download') {
    try {
      const name = url.searchParams.get('name') ?? ''
      if (!name || name !== basename(name) || /[\\/]/.test(name)) throw new Error('Nome inválido.')
      const path = await realpath(join(outputs, name)), base = await realpath(outputs)
      const rel = relative(base, path)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Arquivo fora das entregas.')
      const content = await readFile(path)
      res.writeHead(200, { ...cors, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'x-content-type-options': 'nosniff' }); res.end(content)
    } catch (e) { json(res, cors, 404, { error: e.message }) }
    return true
  }
  if (req.method === 'POST' && url.pathname === '/upload') {
    if (!req.headers.origin || !allowed(req.headers.origin)) { json(res, cors, 403, { error: 'Origem recusada.' }); return true }
    const raw = url.searchParams.get('name') ?? 'arquivo'
    const name = basename(raw).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-140) || 'arquivo'
    const chunks = []; let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 25 * 1024 * 1024) { json(res, cors, 413, { error: 'O limite é 25 MB por arquivo.' }); req.resume(); return true }
      chunks.push(chunk)
    }
    const path = join(uploads, `${randomUUID()}-${name}`)
    await writeFile(path, Buffer.concat(chunks), { flag: 'wx' })
    json(res, cors, 201, { name, path, size: bytes })
    return true
  }
  return false
}

export function filesServer() {
  const reply = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] })
  return createSdkMcpServer({ name: 'files', tools: [
    tool('search_files', 'Procure arquivos pelo nome numa pasta específica, com busca limitada. Não altera arquivos.', { directory: z.string(), query: z.string(), depth: z.number().int().min(0).max(6).default(3) }, async ({ directory, query, depth }) => {
      if (!isAbsolute(directory)) throw new Error('Use um diretório absoluto.')
      const found = []; let examined = 0
      const walk = async (dir, level) => {
        if (examined > 12000 || found.length >= 80) return
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const e of entries) {
          if (++examined > 12000 || found.length >= 80) break
          if (e.isSymbolicLink()) continue
          const path = join(dir, e.name)
          if (e.isFile() && e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push(path)
          if (e.isDirectory() && level < depth && !['node_modules', '.git', '.venv', 'AppData'].includes(e.name)) await walk(path, level + 1)
        }
      }
      await walk(directory, 0)
      return reply({ files: found, examined, limited: examined > 12000 || found.length >= 80 })
    }),
    tool('inspect_document', 'Leia o conteúdo real de um PDF, DOCX, XLSX, CSV, JSON, Markdown ou texto local. Imagens devem ser abertas pela ferramenta de visão.', { path: z.string(), maxCharacters: z.number().int().min(1000).max(60000).default(25000) }, async ({ path, maxCharacters }) => {
      if (!isAbsolute(path)) throw new Error('Use um caminho absoluto.')
      const info = await stat(path)
      if (info.size > 100 * 1024 * 1024) throw new Error('Arquivo maior que 100 MB; use leitura segmentada pelo terminal.')
      const ext = extname(path).toLowerCase()
      if (['.pdf', '.docx', '.xlsx'].includes(ext)) {
        const { stdout } = await exec(join(import.meta.dirname, '..', '.venv', 'Scripts', 'python.exe'), [join(import.meta.dirname, '..', 'scripts', 'inspect-document.py'), path, String(maxCharacters)], { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
        return reply(stdout)
      }
      if (!['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.js', '.ts', '.py', '.css', '.yml', '.yaml'].includes(ext)) throw new Error('Formato não suportado para extração de texto. Use a ferramenta apropriada no terminal.')
      if (info.size > 5 * 1024 * 1024) throw new Error('Texto maior que 5 MB; faça leitura segmentada pelo terminal.')
      const content = await readFile(path, 'utf8')
      return reply({ path, text: content.slice(0, maxCharacters), truncated: content.length > maxCharacters })
    }),
  ] })
}
