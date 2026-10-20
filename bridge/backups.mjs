import {readFile,writeFile,mkdir,rename,stat,access} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {atomicJson,fileLock} from './state-files.mjs'
const root=resolve(import.meta.dirname,'..')
export const BACKUP_FILES=['.local/personality/user.md','.local/personality/settings.json','.local/projects/state.json','.local/discovery/catalog.json','.local/discovery/roots.json','.local/discovery/c-map.json','.local/memory.jsonl','.local/briefing-settings.json','.local/openspeaker.json','.local/telegram.json','.local/backup-settings.json','.local/desktop-settings.json','bridge/persona.pt-BR.txt','docs/briefing-matinal.md','docs/personalidade-e-revisor.md','docs/confiabilidade-e-desktop.md','docs/descoberta-de-projetos.md']
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
// Connection secrets are kept out of ordinary disk snapshots.
function cleanConfig(value,key=''){
 if(/key|token|secret|password|credential|authorization/i.test(key)&&key!=='MEMORY_FILE_PATH')return '[reconfigure]'
 if(Array.isArray(value))return value.map((v,i)=>i>0&&typeof value[i-1]==='string'&&/key|token|secret|password/i.test(value[i-1])?'[reconfigure]':cleanConfig(v))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cleanConfig(v,k)]))
 return value
}
export async function backupJarvis({projectRoot=root,backupDirectory,force=false}={}){
 const local=join(projectRoot,'.local'),settings=JSON.parse((await readFile(join(local,'backup-settings.json'),'utf8')).replace(/^\uFEFF/,''))
 if(!settings.enabled)return {status:'disabled'}
 let destination=backupDirectory||settings.directory
 try{await mkdir(destination,{recursive:true})}catch{destination=join(local,'backups');await mkdir(destination,{recursive:true})}
 return fileLock(join(local,'backup.lock'),async()=>{
  const files={}
  for(const name of BACKUP_FILES){
   const path=resolve(projectRoot,name),rel=relative(projectRoot,path)
   if(rel.startsWith('..')||isAbsolute(rel))throw Error('Caminho de backup inválido.')
   try{
    if((await stat(path)).size>12*1024*1024)throw Error('Arquivo acima do limite do backup: '+name)
    let bytes=await readFile(path)
    if(name.endsWith('.json'))bytes=Buffer.from(JSON.stringify(cleanConfig(JSON.parse(bytes.toString('utf8'))),null,2))
    files[name]={sha256:sha(bytes),data:bytes.toString('base64')}
   }catch(error){if(error.code!=='ENOENT')throw error}
  }
  const fingerprint=sha(Buffer.from(JSON.stringify(Object.entries(files).map(([name,file])=>[name,file.sha256]))))
  let previous;try{previous=JSON.parse(await readFile(join(local,'backup-state.json'),'utf8'))}catch{}
  if(!force&&previous?.fingerprint===fingerprint){try{await stat(previous.path);return {...previous,status:'unchanged'}}catch{}}
  const at=new Date().toISOString(),file=join(destination,at.replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.jarvis-backup.json.gz')
  const serialized=JSON.stringify({format:'jarvis-backup-v1',createdAt:at,files})
  if(Buffer.byteLength(serialized)>32*1024*1024)throw Error('Backup excede o limite de 32 MB descompactados.')
  const bytes=gzipSync(serialized)
  await writeFile(file+'.tmp',bytes);await rename(file+'.tmp',file)
  const verified=inspectBackup(await readFile(file))
  const state={status:'saved',at,path:file,fingerprint,files:Object.keys(verified.files).length,bytes:bytes.length,fallback:destination!==settings.directory}
  await atomicJson(join(local,'backup-state.json'),state);return state
 })
}
export function inspectBackup(bytes){
 const bundle=JSON.parse(gunzipSync(bytes,{maxOutputLength:32*1024*1024}).toString('utf8'))
 if(bundle.format!=='jarvis-backup-v1')throw Error('Formato de backup inválido.')
 for(const [name,file]of Object.entries(bundle.files)){
  if(!BACKUP_FILES.includes(name)||sha(Buffer.from(file.data,'base64'))!==file.sha256)throw Error('Backup inválido ou corrompido: '+name)
 }
 return bundle
}
// Explicit restoration into a NEW directory only; never overwrites production.
export async function restoreBackup(bytes,destination){
 const bundle=inspectBackup(bytes),target=resolve(destination)
 try{await access(target);throw Error('A restauração exige uma pasta nova, ainda inexistente.')}catch(error){if(error.code!=='ENOENT')throw error}
 await mkdir(target,{recursive:true})
 for(const [name,file]of Object.entries(bundle.files)){
  const path=resolve(target,name),rel=relative(target,path)
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('Caminho inválido na restauração.')
  await mkdir(join(path,'..'),{recursive:true});await writeFile(path,Buffer.from(file.data,'base64'),{flag:'wx'})
 }
 return {directory:target,files:Object.keys(bundle.files).length,createdAt:bundle.createdAt}
}
export function startBackups(){
 const run=()=>{void backupJarvis().catch(error=>console.warn('[backup]',error.message))}
 const first=setTimeout(run,3000),timer=setInterval(run,30*60*1000)
 first.unref();timer.unref();return ()=>{clearTimeout(first);clearInterval(timer)}
}
