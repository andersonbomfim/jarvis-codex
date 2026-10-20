import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'

export const PERSONALITY_ROOT = join(import.meta.dirname, '..', '.local', 'personality')
export function loadPersonality(directory = PERSONALITY_ROOT) {
  let settings
  try { settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8').replace(/^\uFEFF/, '')) }
  catch (error) { if (error.code === 'ENOENT') return {enabled:false, reviewerEnabled:false, profile:'', revision:null}; throw error }
  if (settings.enabled !== true) return {enabled:false, reviewerEnabled:false, profile:'', revision:null}
  const profile = readFileSync(join(directory, 'user.md'), 'utf8').trim()
  if (!profile || profile.length > 20000) throw Error('Perfil de Usuário vazio ou acima do limite.')
  return {enabled:true, reviewerEnabled:settings.reviewerEnabled === true, profile,
    revision:settings.revision ?? 'local', hash:createHash('sha256').update(profile).digest('hex'),
    effort:['low','medium','high'].includes(settings.reviewEffort)?settings.reviewEffort:'medium',
    timeoutMs:Math.min(90000, Math.max(1000, Number(settings.reviewTimeoutMs)||65000))}
}

export const REVIEW_POLICY = `SEGUNDO CRITÉRIO: REVISOR DE USUÁRIO
Usuário autorizou permanentemente este agente específico como segunda avaliação. Antes de entregar a versão final de criação autoral substancial, estratégia/planejamento relevante ou uma reformulação após ele dizer que o resultado não parece seu, use user_review__review uma vez com pedido original, rascunho, restrições explícitas e contexto/referências necessários. Use também quando ele solicitar o revisor. Isso vale para projetos novos e existentes.
Prepare o rascunho sem já o apresentar como resultado final ou enviá-lo à voz. O revisor avalia texto fornecido, não lê arquivos por conta própria; você deve ler os materiais reais relevantes e fornecer contexto suficiente, sem credenciais. Para arquivos longos, envie o trecho em avaliação e delimite a abrangência; nunca anuncie revisão integral quando só houve amostra.
A ferramenta devolve um parecer independente, não uma autorização e não uma ação executada. Avalie as sugestões contra o pedido real e a evidência; aplique apenas as pertinentes e confira o resultado. Não peça ao revisor o mesmo parecer em loop. Uma nova revisão cabe quando o objetivo muda ou Usuário solicita outra.
Conversa cotidiana, consulta factual simples, status, conta rápida e execução mecânica delimitada não exigem outra inferência. Use o perfil geral diretamente. Falha ou tempo esgotado da revisão não significa aprovação: finalize com sua própria conferência, identifique a limitação de forma breve quando relevante e não alegue revisão concluída. Não invente o parecer. A ferramenta é o revisor autorizado, não uma licença para criar outros agentes.`

export function personalizedPrompt(base, personality = loadPersonality()) {
  if (!personality.enabled) return base
  return `${base}\n\nPERFIL GERAL DE USUÁRIO — ORIENTAÇÃO APLICÁVEL A TODAS AS CONVERSAS\n${personality.profile}\n\n${personality.reviewerEnabled ? REVIEW_POLICY : ''}`
}
