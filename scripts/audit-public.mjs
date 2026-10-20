import {readdir,readFile} from 'node:fs/promises'
import {resolve,join,relative,extname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=resolve(import.meta.dirname,'..'),skip=new Set(['.git','node_modules','.local','.venv','.runtime','.build','release','dist'])
const privateName=name=>/(^|\/)(?:auth\.json|telegram-token\.txt|openspeaker-key\.txt|\.env(?:\.local)?|jarvis\.config\.local\.json|jarvis-secrets\.cmd)$/.test(name)
export async function auditPublic(directory=root){
 const issues=[];let count=0
 async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
  if(skip.has(entry.name)||entry.isSymbolicLink())continue
  const path=join(folder,entry.name),name=relative(directory,path).replaceAll('\\','/')
  if(entry.isDirectory()){await walk(path);continue}
  if(!entry.isFile())continue;count++
  if(privateName(name))continue
  if(!['.mjs','.json','.md','.txt','.tsx','.ts','.ps1','.cs','.py','.html','.yml','.yaml'].includes(extname(name)))continue
  const text=await readFile(path,'utf8')
  const checks=[[/\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook)\.com\b/i,'contato pessoal'],[/\bclone_\d{4,}\b/,'identificador privado de voz'],[/C:[/\\]Users[/\\](?!Public[/\\]|Default[/\\])[A-Za-z][\w .-]*[/\\]/i,'caminho de perfil pessoal'],[/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,'credencial GitHub'],[/\bsk-[A-Za-z0-9_-]{25,}\b/,'chave de API'],[/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,'token Telegram']]
  // The scanner's own patterns are not personal content or credentials.
  if(name==='scripts/audit-public.mjs')continue
  for(const [pattern,problem]of checks)if(pattern.test(text))issues.push({file:name,problem})
 }}
 await walk(directory)
 const tracked=spawnSync('git',['ls-files','-z'],{cwd:directory,encoding:'utf8',windowsHide:true})
 if(tracked.status===0)for(const name of tracked.stdout.split('\0').filter(Boolean))if(privateName(name)||/^\.(?:local|venv|runtime)\//.test(name))issues.push({file:name,problem:'arquivo privado incluído no Git'})
 return {files:count,issues,passed:issues.length===0}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await auditPublic();console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1}
