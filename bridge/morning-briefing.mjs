import {userProfile,userRoutine} from './user-profile.mjs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {audioMime} from './openspeaker-speech.mjs'
import {atomicJson,fileLock} from './state-files.mjs'
const root=join(import.meta.dirname,'..','.local','briefings')
export const morningDate=(now=new Date(),timezone=userProfile().timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
const time=(date,timezone)=>new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)
async function json(path){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
const terminal=state=>['played','text_delivered','cancelled','text_or_playback_failed'].includes(state?.status)
const busy=(state,now)=>['claimed','playing'].includes(state?.status)&&Date.parse(state.leaseUntil||'')>now.getTime()
export function createMorningBriefingRoute({directoryRoot=root,now=()=>new Date(),timezone,routine=userRoutine,leaseMs=90000,retryMs=60000}={}){
return async function route(req,res,cors){
 const url=new URL(req.url,'http://localhost')
 if(!url.pathname.startsWith('/morning-briefing'))return false
 const zone=timezone||userProfile().timezone,date=morningDate(now(),zone),directory=join(directoryRoot,date),path=join(directory,'delivery.json')
 const send=(status,body)=>{res.writeHead(status,{...cors,'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));return true}
 const inWindow=()=>{const hours=routine();return time(now(),zone)>=hours.deliverAt&&time(now(),zone)<hours.lateAudioCutoff}
 try{
  if(url.pathname==='/morning-briefing'&&req.method==='GET'){
   let text='';try{text=await readFile(join(directory,'briefing.txt'),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
   const state=await json(join(directory,'audio-state.json')),delivery=await json(path)
   return send(200,{date,due:inWindow(),text,status:state?.status||'waiting',delivered:terminal(delivery),deliveryStatus:delivery?.status||'waiting',inProgress:busy(delivery,now()),retryAt:delivery?.retryAt||null,audioUrl:state?.status==='ready'?`/morning-briefing/audio?date=${date}`:null})
  }
  if(url.searchParams.get('date')!==date)return send(400,{error:'Somente o briefing de hoje está disponível.'})
  if(url.pathname==='/morning-briefing/audio'&&req.method==='GET'){
   if((await json(join(directory,'audio-state.json')))?.status!=='ready')return send(404,{error:'Áudio ainda não disponível.'})
   const bytes=await readFile(join(directory,'briefing.audio'));res.writeHead(200,{...cors,'content-type':audioMime(bytes),'content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return true
  }
  if(req.method!=='POST')return send(404,{error:'Operação desconhecida.'})
  return await fileLock(join(directory,'delivery.lock'),async()=>{
   const previous=await json(path),token=url.searchParams.get('token')
   if(url.pathname==='/morning-briefing/claim'){
    if(!inWindow())return send(409,{error:'Fora do horário da entrega automática.'})
    if(terminal(previous)||busy(previous,now())||Date.parse(previous?.retryAt||'')>now().getTime()||(previous?.attempts||0)>=3)return send(409,{error:'Entrega concluída, reservada ou aguardando recuperação.'})
    await readFile(join(directory,'briefing.txt'),'utf8')
    const state={status:'claimed',token:randomUUID(),attempts:(previous?.attempts||0)+1,at:now().toISOString(),leaseUntil:new Date(now().getTime()+leaseMs).toISOString()}
    await atomicJson(path,state);return send(200,{ok:true,token:state.token,leaseMs})
   }
   if(!previous||!token||previous.token!==token)return send(409,{error:'Esta janela não possui a reserva da entrega.'})
   if(url.pathname==='/morning-briefing/heartbeat'){
    if(!inWindow()||!busy(previous,now()))return send(409,{error:'Reserva expirada.'})
    await atomicJson(path,{...previous,status:'playing',leaseUntil:new Date(now().getTime()+leaseMs).toISOString()});return send(200,{ok:true})
   }
   if(url.pathname==='/morning-briefing/finished'){
    if(terminal(previous))return send(200,{ok:true,status:previous.status})
    const requested=url.searchParams.get('status'),status=requested==='played'?'played':requested==='text'?'text_delivered':requested==='cancelled'?'cancelled':'interrupted'
    await atomicJson(path,{...previous,status,finishedAt:now().toISOString(),retryAt:status==='interrupted'?new Date(now().getTime()+retryMs).toISOString():null,leaseUntil:null})
    return send(200,{ok:true,status})
   }
   return send(404,{error:'Operação desconhecida.'})
  })
 }catch{return send(503,{error:'Não foi possível consultar o briefing matinal.'})}
}}
export const morningBriefingRoute=createMorningBriefingRoute()
