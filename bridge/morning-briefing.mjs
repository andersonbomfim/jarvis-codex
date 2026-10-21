import {userProfile} from './user-profile.mjs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {audioMime} from './openspeaker-speech.mjs'
import {atomicJson,fileLock} from './state-files.mjs'
const root=join(import.meta.dirname,'..','.local','briefings')
export const morningDate=(now=new Date(),timezone=userProfile().timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
async function json(path){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
const terminal=state=>['played','text_delivered','cancelled','text_or_playback_failed'].includes(state?.status)
const busy=(state,now)=>['claimed','playing'].includes(state?.status)&&Date.parse(state.leaseUntil||'')>now.getTime()
export function createMorningBriefingRoute({directoryRoot=root,now=()=>new Date(),timezone}={}){
return async function route(req,res,cors){
 const url=new URL(req.url,'http://localhost')
 if(!url.pathname.startsWith('/morning-briefing'))return false
 const date=morningDate(now(),timezone),directory=join(directoryRoot,date),path=join(directory,'delivery.json')
 const send=(status,body)=>{res.writeHead(status,{...cors,'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));return true}
 try{
  if(url.pathname==='/morning-briefing'&&req.method==='GET'){
   let text='';try{text=await readFile(join(directory,'briefing.txt'),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
   const state=await json(join(directory,'audio-state.json')),delivery=await json(path)
   return send(200,{date,due:false,playbackMode:'on_request',text,status:state?.status||'waiting',delivered:terminal(delivery),deliveryStatus:delivery?.status||'waiting',inProgress:busy(delivery,now()),retryAt:delivery?.retryAt||null,audioUrl:state?.status==='ready'?`/morning-briefing/audio?date=${date}`:null})
  }
  if(url.searchParams.get('date')!==date)return send(400,{error:'Somente o briefing de hoje está disponível.'})
  if(url.pathname==='/morning-briefing/audio'&&req.method==='GET'){
   if((await json(join(directory,'audio-state.json')))?.status!=='ready')return send(404,{error:'Áudio ainda não disponível.'})
   const bytes=await readFile(join(directory,'briefing.audio'));res.writeHead(200,{...cors,'content-type':audioMime(bytes),'content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return true
  }
  if(req.method!=='POST')return send(404,{error:'Operação desconhecida.'})
  // Old windows are also denied an automatic playback lease.
  if(['/morning-briefing/claim','/morning-briefing/heartbeat'].includes(url.pathname))return send(409,{error:'O briefing só é reproduzido quando solicitado.'})
  return await fileLock(join(directory,'delivery.lock'),async()=>{
   const previous=await json(path),token=url.searchParams.get('token')
   if(!previous||!token||previous.token!==token)return send(409,{error:'Esta janela não possui a reserva da entrega.'})
   if(url.pathname==='/morning-briefing/finished'){
    if(terminal(previous))return send(200,{ok:true,status:previous.status})
    const requested=url.searchParams.get('status'),status=requested==='played'?'played':requested==='text'?'text_delivered':requested==='cancelled'?'cancelled':'interrupted'
    await atomicJson(path,{...previous,status,finishedAt:now().toISOString(),retryAt:null,leaseUntil:null})
    return send(200,{ok:true,status})
   }
   return send(404,{error:'Operação desconhecida.'})
  })
 }catch{return send(503,{error:'Não foi possível consultar o briefing matinal.'})}
}}
export const morningBriefingRoute=createMorningBriefingRoute()
