import {readFile,writeFile,mkdir,open,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {morningDate} from './morning-briefing.mjs'
import {readPreparedBriefing} from './telegram-briefing.mjs'

const local=join(import.meta.dirname,'..','.local')
async function json(path,fallback) {
  try{return JSON.parse(await readFile(path,'utf8'))}
  catch(error){if(error.code==='ENOENT')return fallback;throw error}
}
async function replace(path,value) {
  const temporary=path+'.'+randomUUID()+'.tmp'
  await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600})
  await rename(temporary,path)
}

/** Called only by the authenticated owner's single Telegram worker, while idle.
 * Reads the existing recording; never synthesizes, plays or opens a window.
 */
export function createTelegramMorningDelivery({
  directoryRoot=join(local,'briefings'),
  readSettings=()=>json(join(local,'briefing-settings.json'),{}),
  now=()=>new Date(),timezone,
  read=()=>readPreparedBriefing({directoryRoot,now:now(),timezone}),
  manualDelivery=()=>null,send,
}={}) {
  return async function deliver() {
    if((await readSettings()).telegramDelivery?.enabled!==true)return {status:'disabled'}
    const date=morningDate(now(),timezone),folder=join(directoryRoot,date)
    const path=join(folder,'telegram-delivery.json')
    const previous=await json(path,null)
    // A persisted in-flight/uncertain upload may already be on Telegram.
    // Never blindly repeat it after a restart or connection loss.
    if(previous)return previous
    const manual=manualDelivery()
    const alreadySent=manual?.date===date&&manual.status==='sent'&&manual.messageId
    const briefing=alreadySent?manual:await read()
    if(briefing.status!=='ready'&&!alreadySent)return {date,status:'waiting'}
    if(briefing.date!==date||morningDate(now(),timezone)!==date)return {date,status:'expired'}
    await mkdir(folder,{recursive:true})
    let claim
    try{claim=await open(path,'wx',0o600)}
    catch(error){if(error.code==='EEXIST')return {date,status:'claimed'};throw error}
    const pending={date,status:alreadySent?'sent':'sending',source:alreadySent?'manual':'automatic',
      taskId:briefing.taskId,at:now().toISOString(),...(alreadySent?{messageId:manual.messageId}:{}),
    }
    try{await claim.writeFile(JSON.stringify(pending,null,2))}finally{await claim.close()}
    if(alreadySent)return pending
    try {
      const message=await send(briefing.audio)
      if(!message?.message_id)throw Error('O Telegram não confirmou o identificador da mensagem de áudio.')
      const sent={...pending,status:'sent',messageId:message.message_id,bytes:briefing.audio.length,sentAt:now().toISOString()}
      await replace(path,sent)
      return sent
    } catch(error) {
      const uncertain={...pending,status:'uncertain',error:String(error.message),failedAt:now().toISOString()}
      await replace(path,uncertain)
      throw error
    }
  }
}
