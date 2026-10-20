import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {renderLongAudio,splitNarration} from '../bridge/long-work.mjs'
import {createOpenSpeakerClient,openSpeakerConfig} from '../bridge/openspeaker-speech.mjs'
import {telegramApi} from '../bridge/telegram.mjs'
const root=resolve(import.meta.dirname,'..'),run=promisify(execFile)
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1]}
const input=option('--input'),voiceName=option('--voice'),runFolder=option('--job')
if(!input||!voiceName||!runFolder)throw Error('Informe --input, --voice e --job.')
const text=await readFile(input,'utf8')
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({characters:text.length,parts:splitNarration(text).length,newGenerations:0}));process.exit(0)}
await mkdir(runFolder,{recursive:true})
const lockPath=join(runFolder,'runner.lock')
let lock
try{lock=await open(lockPath,'wx')}catch(error){
  if(error.code!=='EEXIST')throw error
  const owner=JSON.parse(await readFile(lockPath,'utf8'))
  let active=true;try{process.kill(owner.pid,0)}catch(probe){if(probe.code==='ESRCH')active=false;else throw probe}
  if(active){console.log('Este trabalho já está em andamento.');process.exit(0)}
  await unlink(lockPath);lock=await open(lockPath,'wx')
}
await lock.writeFile(JSON.stringify({pid:process.pid}))
let api,config
try{
  config=JSON.parse(await readFile(join(root,'.local','telegram.json'),'utf8'))
  const token=(await readFile(join(root,'.local','telegram-token.txt'),'utf8')).trim()
  api=telegramApi(token)
  const deliveryPath=join(runFolder,'delivery.json')
  let delivered;try{delivered=JSON.parse(await readFile(deliveryPath,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(delivered?.messageId){console.log('Arquivo já entregue; envio não repetido.');process.exitCode=0}
  else {
    const speaker=openSpeakerConfig()
    if(!speaker?.enabled)throw Error('OpenSpeaker está desativado; nenhuma geração iniciada.')
    const key=(await readFile(join(root,'.local','openspeaker-key.txt'),'utf8')).trim()
    const response=await fetch(speaker.apiBase+'/v3/voices?provider=clone&search='+encodeURIComponent(voiceName)+'&page_size=100',{headers:{'xi-api-key':key},signal:AbortSignal.timeout(30000)})
    if(!response.ok)throw Error('Não consegui verificar a voz solicitada no OpenSpeaker.')
    const catalog=await response.json()
    const matches=(catalog.data||[]).filter(voice=>voice.name?.toLocaleLowerCase()===voiceName.toLocaleLowerCase())
    if(matches.length!==1)throw Error('A voz solicitada não foi identificada de forma única; nenhuma voz alternativa foi escolhida.')
    const voice=matches[0]
    const client=createOpenSpeakerClient({apiKey:key,voiceId:voice.voice_id,speed:1,apiBase:speaker.apiBase})
    const result=await renderLongAudio({text,voiceId:voice.voice_id,voiceName:voice.name,generate:part=>client.generate(part),
      cancelled:async()=>{try{await readFile(join(runFolder,'cancel.request'));return true}catch(error){if(error.code==='ENOENT')return false;throw error}},
      joinParts:async(output,parts,meta)=>run(join(root,'.venv','Scripts','python.exe'),[join(root,'scripts','join-mp3-parts.py'),output,...parts,'--title',meta.title,'--artist',meta.voiceName],{windowsHide:true,maxBuffer:1024*1024}),
    })
    await writeFile(join(runFolder,'result.json'),JSON.stringify(result,null,2))
    if(result.bytes>49*1024*1024)throw Error('O arquivo completo foi salvo, mas excede o tamanho de envio deste canal: '+result.output)
    const bytes=await readFile(result.output),form=new FormData()
    form.append('chat_id',String(config.ownerChatId));form.append('audio',new Blob([bytes],{type:'audio/mpeg'}),basename(result.output))
    form.append('title',basename(result.output,'.mp3'));form.append('performer',voice.name)
    form.append('caption','Áudio completo, reunido em um único arquivo.')
    const sent=await api.call('sendAudio',form)
    await writeFile(deliveryPath,JSON.stringify({messageId:sent.message_id,file:result.output,at:new Date().toISOString()},null,2))
    console.log(JSON.stringify({status:'delivered',file:result.output,messageId:sent.message_id,cached:result.cached}))
  }
}catch(error){
  await writeFile(join(runFolder,'error.json'),JSON.stringify({at:new Date().toISOString(),message:error.message},null,2))
  if(api&&config)await api.call('sendMessage',{chat_id:config.ownerChatId,text:'Senhor, o trabalho foi preservado, mas a entrega não concluiu: '+error.message}).catch(()=>{})
  process.exitCode=1
}finally{await lock.close();await unlink(lockPath).catch(()=>{})}
