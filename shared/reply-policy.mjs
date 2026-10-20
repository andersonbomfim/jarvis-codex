import presets from './voice-presets.json' with {type:'json'}
import {speechText} from './speech-text.mjs'

export function isMorningBriefingRequest(text) {
  let value=String(text).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()
  value=value.replace(/^(?:ola|oi|bom dia|boa tarde|boa noite)\s+/, '').replace(/^jarvis\s+/, '')
    .replace(/\b(?:por favor|para mim|pra mim)\b/g,'').replace(/\s+/g,' ').trim()
  return /^(?:(?:voce )?(?:pode |poderia )?(?:me )?(?:mostre|mostrar|leia|ler|reproduza|reproduzir|toque|tocar|abra|abrir|envie|enviar|mande|mandar|diga|quero ouvir|quero ver|qual e) )?(?:(?:o |meu |o meu ))?(?:briefing(?: matinal)?|brifing(?: matinal)?|resumo (?:do meu dia|do dia)|relatorio (?:de hoje|do dia))(?: (?:de hoje|hoje))*$/.test(value)
}

/** Cached completion only. Never imply success for a failed or blocked result. */
export function completionPhrase(text) {
  const plain=speechText(text).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  let id='ready'
  if(/nao (?:consegui|foi possivel)|falh(?:ou|a ao)/.test(plain))id='failed'
  else if(/(?:preciso|aguardo).{0,60}(?:aprovacao|autorizacao|confirmacao)/.test(plain))id='confirmation'
  else if(/nao encontrei|impedimento|sem acesso|indisponivel/.test(plain))id='blocked'
  else if(/^(?:senhor,?\s+)?(?:encontrei|localizei|achei)\b/.test(plain))id='found'
  return presets.find(preset=>preset.id===id).text
}
