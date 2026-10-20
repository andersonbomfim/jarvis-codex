import presets from './voice-presets.json' with { type: 'json' }

const thanks = /^(?:(?:muito|muitissimo) )?(?:obrigado|obrigada)(?: mesmo| por tudo)?(?: senhor)?$|^(?:valeu|valeu mesmo|agradecido|agradecida)$/
const courtesy = /^(?:de qualquer forma|de qualquer jeito|de todo modo|mesmo assim|ainda assim) /
const closing = /^(?:(?:eu )?(?:acho|acredito|penso) que )?(?:nao vale a pena|nao compensa|nao precisa(?: mais)?|nao e necessario|deixa (?:pra|para) la|deixe (?:pra|para) la|vamos deixar (?:pra|para) la|por enquanto e so|era so isso|e so isso|por hoje e so) /

function isThanks(text) {
  // Match the entire message, including a conversational closing when present.
  // A trailing request, question, approval or substantive explanation fails closed.
  return thanks.test(text.replace(closing, '').replace(courtesy, ''))
}

// Only complete social messages qualify. Never consume an approval or a task.
export function quickReplyFor(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /^\s*\//.test(value)) return null
  const text = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:ei )?jarvis\b\s*|\s*\bjarvis$/g, '').trim()
  let id
  if (!text && /jarvis/i.test(value)) id = 'attention'
  else if (/^(?:(?:voce|tu) )?(?:esta|estas|ta|tas) (?:ai|ali|aqui|por ai|acordado|online|me ouvindo)$/.test(text) || /^(?:acordado|acordou|acorda|ai|ta acordado ai|esta acordado ai|tem alguem ai|voce consegue me ouvir|consegue me ouvir|esta me escutando|me ouve|voce me ouve|me escuta|voce me escuta)$/.test(text)) id = 'presence'
  else if (isThanks(text)) id = 'thanks'
  else if (/^(?:de nada|por nada|nao ha de que)$/.test(text)) id = 'gratitude'
  else if (/^(?:bom dia|boa tarde|boa noite)(?: senhor)?$/.test(text)) id = { 'bom dia': 'good-morning', 'boa tarde': 'good-afternoon', 'boa noite': 'good-evening' }[text.replace(/ senhor$/, '')]
  else if (/^(?:oi|ola|opa|ei|e ai)(?: senhor)?$/.test(text)) id = 'attention'
  return id ? presets.find(item => item.id === id) ?? null : null
}

export function quickReplyForMessage(message) {
  if (message?.document || message?.voice || message?.audio || message?.photo || message?.forward_origin) return null
  return quickReplyFor(message?.text)
}
