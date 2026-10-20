import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {initialize} from './initialize.mjs'
const root=resolve(import.meta.dirname,'..');process.chdir(root);await initialize()
const profile=JSON.parse(await readFile(resolve(root,'.local/profile.json'),'utf8'))
const env={...process.env,JARVIS_ALLOW_WRITES:profile.allowWrites?'1':'0',JARVIS_EFFORT:'medium'}
const children=[];let stopping=false
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();setTimeout(()=>process.exit(code),300)}
for(const script of ['bridge/server.mjs','scripts/serve-ui.mjs','bridge/telegram.mjs']){
 const child=spawn(process.execPath,[resolve(root,script)],{cwd:root,env,windowsHide:true,stdio:'inherit'});children.push(child)
 child.on('error',e=>{console.error(e.message);stop(1)});child.on('exit',code=>{if(script!=='bridge/telegram.mjs'||code)stop(code||0)})
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop())
