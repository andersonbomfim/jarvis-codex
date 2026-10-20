import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export const politicalNewsPath = join(import.meta.dirname, '..', '.local', 'news', 'politics', 'latest.json')
export const POLITICAL_NEWS_MAX_AGE_MS = 75 * 60 * 1000
export function validatePoliticalNews(data, now = Date.now()) {
  if (!data || !Array.isArray(data.articles) || !data.articles.length || typeof data.narration !== 'string' || !data.narration.trim() || data.narration.length > 5000) throw new Error('Resumo político incompleto.')
  const timestamp = Date.parse(data.updatedAt)
  if (!Number.isFinite(timestamp) || timestamp > now + 60000) throw new Error('Horário da atualização política inválido.')
  for (const article of data.articles) {
    const url = new URL(article.url)
    if (!['https:', 'http:'].includes(url.protocol) || !article.title || !article.summary || !article.source) throw new Error('Notícia política sem fonte ou resumo verificável.')
  }
  return data
}
export async function publishPoliticalNews(data) {
  validatePoliticalNews(data)
  await mkdir(dirname(politicalNewsPath), { recursive: true })
  const temporary = politicalNewsPath + '.' + process.pid + '.tmp'
  await writeFile(temporary, JSON.stringify(data, null, 2))
  await rename(temporary, politicalNewsPath)
}
export async function readPoliticalNews({ now = Date.now(), path = politicalNewsPath } = {}) {
  try {
    const data = validatePoliticalNews(JSON.parse(await readFile(path, 'utf8')), now)
    const age = now - Date.parse(data.updatedAt)
    return { ...data, fresh: age >= 0 && age <= POLITICAL_NEWS_MAX_AGE_MS, ageMinutes: Math.floor(Math.max(0, age) / 60000) }
  } catch (error) { return { fresh: false, unavailable: true, reason: error.code === 'ENOENT' ? 'A primeira atualização ainda não foi preparada.' : 'A atualização armazenada está indisponível.' } }
}
export async function politicalNewsRoute(req, res, cors) {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/news/politics') return false
  if (req.method !== 'GET') { res.writeHead(405, cors); res.end(); return true }
  const data = await readPoliticalNews()
  const scope = url.searchParams.get('scope') || 'geral'
  const narration = scope === 'brasil' ? data.brazilNarration : scope === 'mundo' ? data.worldNarration : data.narration
  res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ...data, narration: narration || null, scope })); return true
}
