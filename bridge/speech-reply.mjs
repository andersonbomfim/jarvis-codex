import { readVoicePreset, voicePresetForText } from './voice-library.mjs'

/** Fixed replies must never fall back to paid synthesis when their recording is missing. */
export async function speechReply(text, { telegram = false, readPreset = readVoicePreset } = {}) {
  const preset = voicePresetForText(text)
  if (!preset) return null
  const audio = await readPreset(preset.id, { telegram })
  if (!audio) throw new Error('A gravação desta frase está indisponível. Não foi feita uma nova geração.')
  return audio
}
