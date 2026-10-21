import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir,userInfo} from 'node:os'
import {z} from 'zod'
import {atomicJson} from './state-files.mjs'
import {createSdkMcpServer,tool} from './local-tools.mjs'
const profilePath=join(import.meta.dirname,'..','.local','profile.json')
const fields={displayName:z.string().trim().min(1).max(100),city:z.string().trim().max(150),timezone:z.string().refine(value=>{try{new Intl.DateTimeFormat('pt-BR',{timeZone:value});return true}catch{return false}},'Fuso inválido'),addressAs:z.string().max(50),interests:z.array(z.string().max(150)).max(30),preferences:z.array(z.string().max(500)).max(50),workContext:z.string().max(4000)}
export const ProfileUpdate=z.object(fields).partial().strict()
export function userProfile(){
  const defaults={displayName:userInfo().username,city:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,addressAs:'senhor',interests:[],preferences:[],workContext:'',allowWrites:false}
  try{return {...defaults,...JSON.parse(readFileSync(profilePath,'utf8').replace(/^\uFEFF/,''))}}catch(e){if(e.code!=='ENOENT')throw e;return defaults}
}
export function userRoutine(){
  let settings={};try{settings=JSON.parse(readFileSync(join(import.meta.dirname,'..','.local','briefing-settings.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  const clock=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value||'')
  return {prepareAt:clock(settings.prepareAt)?settings.prepareAt:'06:25',readyBy:clock(settings.readyBy)?settings.readyBy:'06:55',playbackMode:'on_request',automaticPlayback:false,telegramDelivery:{enabled:settings.telegramDelivery?.enabled===true,mode:'when_ready'}}
}
export function publicProfile(){const p=userProfile();return {displayName:p.displayName,city:p.city,timezone:p.timezone,addressAs:p.addressAs,...userRoutine()}}
export function personalContext(){return '\n\nPERFIL PESSOAL LOCAL, fornecido pelo próprio usuário. Use como contexto, sem inventar dados ausentes. Preferências não autorizam compras ou mensagens a terceiros:\n'+JSON.stringify(userProfile())+'\nPasta pessoal: '+homedir()}
export async function updateProfile(input,path=profilePath,current=userProfile()){
  const update=ProfileUpdate.parse(input),next={...current,...update,updatedAt:new Date().toISOString()}
  await atomicJson(path,next);return next
}
export function userProfileServer(){return createSdkMcpServer({name:'personal',tools:[
  tool('get_profile','Conheça a pessoa, sua cidade, interesses, preferências e contexto de trabalho confirmados. Ausência de um campo não permite inventá-lo.',{},async()=>({content:[{type:'text',text:JSON.stringify(userProfile())}]})),
  tool('update_profile','Registre ajustes explicitamente confirmados pela própria pessoa. Não copie o perfil de terceiros, não infira dados sensíveis nem trate ficção como biografia. Preserve os campos e preferências que não mudaram.',ProfileUpdate.shape,async input=>({content:[{type:'text',text:JSON.stringify(await updateProfile(input))}]})),
]})}
