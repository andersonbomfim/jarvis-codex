import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {morningDate} from './morning-briefing.mjs'
import {audioMime} from './openspeaker-speech.mjs'
import {isMorningBriefingRequest} from '../shared/reply-policy.mjs'

const root=join(import.meta.dirname,'..','.local','briefings')

/** Read only today's accepted artifact. This path has no model or synthesis dependency. */
export async function readPreparedBriefing({directoryRoot=root,now=new Date(),timezone}={}) {
  const date=morningDate(now,timezone),directory=join(directoryRoot,date)
  try {
    const state=JSON.parse(await readFile(join(directory,'audio-state.json'),'utf8'))
    if(state.status!=='ready'||state.date!==date)return {date,status:'unavailable'}
    const audio=await readFile(join(directory,'briefing.audio'))
    if(!audio.length||audio.length>49*1024*1024)throw Error('Arquivo de áudio inválido ou acima do limite de envio.')
    const contentType=audioMime(audio)
    if(!['audio/mpeg','audio/ogg'].includes(contentType))throw Error('O briefing precisa estar em um formato de mensagem de voz compatível.')
    return {date,status:'ready',audio,contentType,taskId:state.taskId}
  } catch(error) {
    if(error.code==='ENOENT')return {date,status:'unavailable'}
    throw error
  }
}

/** One existing audio, no acknowledgement, conclusion clip or duplicate written narration. */
export async function deliverPreparedBriefing(text,{eligible=true,intent,read=readPreparedBriefing,send,tell,isCurrent=()=>true,replyTo}={}) {
  if(!eligible||(intent?intent.route!=='briefing':!isMorningBriefingRequest(text)))return null
  const briefing=await read()
  if(!isCurrent())return {date:briefing.date,status:'cancelled'}
  if(briefing.status!=='ready') {
    await tell('O áudio do briefing de hoje ainda não está pronto, senhor.')
    return {date:briefing.date,status:'unavailable'}
  }
  const sent=await send(briefing.audio,{replyTo})
  return {date:briefing.date,status:'sent',taskId:briefing.taskId,messageId:sent?.message_id,bytes:briefing.audio.length}
}
