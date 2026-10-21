import {mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {homedir,userInfo} from 'node:os'
import {pathToFileURL} from 'node:url'
import {ProfileUpdate} from '../bridge/user-profile.mjs'
const defaultRoot=resolve(import.meta.dirname,'..')
export async function initialize({root=defaultRoot,profile={}}={}){
  const local=join(root,'.local'),defaults={displayName:userInfo().username,city:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,addressAs:'senhor',interests:[],preferences:[],workContext:''}
  const confirmed=ProfileUpdate.parse(profile)
  for(const folder of ['outputs','uploads','diagnostics','personality','projects','discovery','briefings','telegram/inbox'])await mkdir(join(local,folder),{recursive:true})
  const ensure=async(name,value)=>{const path=join(local,name);try{await access(path);return false}catch(e){if(e.code!=='ENOENT')throw e};await writeFile(path,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});return true}
  const created=await ensure('profile.json',{...defaults,...confirmed,allowWrites:false})
  if(!created&&Object.keys(confirmed).length){const path=join(local,'profile.json'),previous=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...previous,...confirmed,updatedAt:new Date().toISOString()},null,2),{mode:0o600})}
  await ensure('openspeaker.json',{enabled:false,fixedVoiceEnabled:true,voiceId:null,speed:1})
  await ensure('desktop-settings.json',{voiceEnabled:true})
  await ensure('personality/settings.json',{enabled:false,reviewerEnabled:false,revision:'community-v1'})
  await ensure('projects/state.json',{schemaVersion:1,projects:[]})
  await ensure('discovery/roots.json',{roots:[{path:homedir(),depth:1}]})
  await ensure('backup-settings.json',{enabled:true,directory:join(local,'backups')})
  await ensure('briefing-settings.json',{timezone:confirmed.timezone||defaults.timezone,weatherCity:confirmed.city||'',prepareAt:'06:25',readyBy:'06:55',playbackMode:'on_request',automaticPlayback:false,telegramDelivery:{enabled:false,mode:'when_ready'},maximumWords:500,maximumCharacters:10000,newsLimit:5,emailLimit:5,projectLimit:4,interactiveSpeechGeneration:false,morningAudioPreparedInAdvance:false,generationEnabled:false})
  await ensure('telegram.json',{enabled:false,voiceReplies:true,automaticReplyDelayMs:2000,ownerUserId:null,ownerChatId:null,botUsername:null})
  const config=join(root,'jarvis.config.local.json');try{await access(config)}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(config,'{"mcpServers":{}}\n',{flag:'wx',mode:0o600})}
  return {created,root,recordings:'41 bundled; no generation or API key required',personalDataImported:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let profile={};const index=process.argv.indexOf('--profile');if(index>=0)profile=JSON.parse((await readFile(process.argv[index+1],'utf8')).replace(/^\uFEFF/,''))
 console.log(JSON.stringify(await initialize({profile})))
}
