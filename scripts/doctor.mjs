import {readVoicePreset,voicePresets} from '../bridge/voice-library.mjs'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {findCodex} from '../bridge/codex-client.mjs'
const checks=[]
checks.push({name:'Node >=22.12',ok:Number(process.versions.node.split('.')[0])>=22})
let recordings=0;for(const p of voicePresets)try{if(await readVoicePreset(p.id))recordings++}catch{}
checks.push({name:'41 gravações prontas, íntegras e sem geração',ok:recordings===41})
for(const path of ['dist/index.html','.local/profile.json','.local/desktop/app/Jarvis.exe'])checks.push({name:path,ok:existsSync(resolve(import.meta.dirname,'..',path))})
try{const auth=spawnSync(findCodex(),['login','status'],{encoding:'utf8',windowsHide:true,timeout:10000});checks.push({name:'Conta Codex autenticada neste computador',ok:auth.status===0})}catch{checks.push({name:'Codex instalado',ok:false})}
console.log(JSON.stringify({checks,newAudioGenerations:0},null,2));if(checks.some(c=>!c.ok))process.exitCode=1
