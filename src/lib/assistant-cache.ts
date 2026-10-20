import presets from '../../shared/voice-presets.json'
import { quickReplyFor } from '../../shared/quick-replies.mjs'

export const fixedPhrases = presets
export const phrase = (id: string) => presets.find(item => item.id === id)!.text
const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^jarvis\s+|\s+jarvis$/g, '').trim()

export function fixedReplyFor(text: string) {
  return quickReplyFor(text)
}

export function acknowledgementFor(text: string): string | null {
  const input = normalize(text)
  if (/^(?:pesquise|pesquisa|procure|busque|investigue|me atualize|quais (?:sao )?as noticias|o que esta acontecendo)/.test(input)) return phrase('research')
  if (/^(?:consulte|verifique|veja|leia).*(?:e mail|emails|correio|caixa de entrada)/.test(input)) return phrase('email')
  if (/^(?:consulte|verifique|veja|qual|como).*(?:agenda|compromissos)/.test(input)) return phrase('calendar')
  if (/^(?:qual|como|veja|consulte|verifique).*(?:tempo|previsao|clima)/.test(input)) return phrase('weather')
  if (/^(?:abra|abrir|inicie)/.test(input)) return phrase('opening')
  return null
}

export function broadPoliticsScope(text: string): 'geral' | 'brasil' | 'mundo' | null {
  const input = normalize(text)
  const broad = /^(?:(?:me de|me diga|me conte|mostre|consulte|pesquise) )?(?:(?:as|um|uma|o) )?(?:noticias politicas|noticias de politica|resumo politico|novidades politicas|atualizacao politica)(?: (?:de hoje|agora|mais recentes|do brasil|no brasil|brasileiras|do mundo|no mundo|internacionais))?$/
  if (!broad.test(input) && !/^(?:me atualize sobre (?:a )?politica|o que esta acontecendo na politica|quais (?:sao )?as (?:ultimas )?noticias politicas)(?: (?:hoje|agora|do brasil|no mundo))?$/.test(input)) return null
  return /brasil|brasileiras/.test(input) ? 'brasil' : /mundo|internacionais/.test(input) ? 'mundo' : 'geral'
}

const clips = new Map<string, string>()
export const isPresetClip = (url: string) => Array.from(clips.values()).includes(url)
const inFlight = new Map<string, Promise<string | null>>()
export async function presetAudio(text: string, baseUrl: string): Promise<string | null> {
  const preset = presets.find(item => normalize(item.text) === normalize(text))
  if (!preset) return null
  if (clips.has(preset.id)) return clips.get(preset.id)!
  if (inFlight.has(preset.id)) return inFlight.get(preset.id)!
  const work = fetch(baseUrl + '/speech-presets/' + preset.id, { signal: AbortSignal.timeout(3000) }).then(async response => {
    if (!response.ok) return null
    const url = URL.createObjectURL(await response.blob())
    clips.set(preset.id, url); return url
  }).catch(() => null)
  inFlight.set(preset.id, work)
  try { return await work } finally { inFlight.delete(preset.id) }
}
export function isFixedPhrase(text: string) { return presets.some(item => normalize(item.text) === normalize(text)) }
export async function preloadVoicePresets(baseUrl: string) {
  try {
    const response = await fetch(baseUrl + '/speech-presets', { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return
    const data = await response.json() as { presets: Array<{ text: string; ready: boolean }> }
    await Promise.all(data.presets.filter(item => item.ready).map(item => presetAudio(item.text, baseUrl)))
  } catch { /* A missing library never triggers paid synthesis. */ }
}
