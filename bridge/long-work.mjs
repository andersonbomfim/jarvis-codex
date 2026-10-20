import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {openSync,closeSync} from 'node:fs'
import {once} from 'node:events'
import {atomicJson} from './state-files.mjs'
import {audioMime} from './openspeaker-speech.mjs'
const sha=value=>createHash('sha256').update(value).digest('hex')
const root=resolve(import.meta.dirname,'..')

/** Keep long writing in a file instead of refusing it or repeatedly filling chat context. */
export async function prepareLongRequest(text,{messageId,inbox=join(root,'.local','telegram','inbox'),inlineLimit=12000}={}) {
  if(text.length<=inlineLimit)return {prompt:text,historyText:text}
  await mkdir(inbox,{recursive:true})
  const file=join(inbox,String(messageId).replace(/[^\w-]/g,'_')+'-'+sha(text).slice(0,12)+'.txt')
  await writeFile(file,text,'utf8')
  if(sha(await readFile(file))!==sha(text))throw Error('O texto integral não foi preservado.')
  const header=text.split(/\n\s*\n/)[0].slice(0,1000)
  const prompt='Pedido de Usuário, com material longo preservado integralmente em arquivo local. '+
    'Leia o arquivo completo antes de executar. Não peça para ele dividir ou reenviar; não resuma, corte ou reescreva o texto autoral sem autorização. '+
    'Cabeçalho do pedido: '+header+'\nArquivo integral: '+JSON.stringify(file)+'\nCaracteres: '+text.length+'. '+
    'Limites de contexto e do fornecedor devem ser resolvidos internamente, mantendo uma única entrega. '+
    'Para um áudio solicitado como produto, use scripts/render-long-audio.mjs; o programa divide internamente, retoma partes concluídas e reúne um único arquivo.'
  return {prompt,historyText:'Pedido com texto integral preservado em '+file+' ('+text.length+' caracteres). '+header,file}
}

/** Every character belongs to exactly one part, preferably cut at a paragraph/sentence. */
export function splitNarration(text,limit=9000) {
  if(!Number.isInteger(limit)||limit<100)throw Error('Limite de trecho inválido.')
  const parts=[]
  for(let start=0;start<text.length;) {
    let end=Math.min(text.length,start+limit)
    if(end<text.length) {
      const piece=text.slice(start,end)
      let cut=piece.lastIndexOf('\n\n')
      if(cut>=limit/2)end=start+cut+2
      else {
        const matches=[...piece.matchAll(/[.!?…][”"']?\s+/g)]
        const last=matches.at(-1)
        cut=last?last.index+last[0].length:-1
        if(cut>=limit/2)end=start+cut
        else {cut=piece.lastIndexOf(' ');if(cut>=limit/2)end=start+cut+1}
      }
      if(/[\uD800-\uDBFF]/.test(text[end-1]))end--
    }
    parts.push(text.slice(start,end));start=end
  }
  return parts
}

export function narrationRequest(text) {
  const boundary=/\n\s*\n/.exec(text)
  if(!boundary)return null
  const header=text.slice(0,boundary.index)
  if(header.length>1000||!/^\s*(?:jarvis[,\s]+)?(?:gere|crie|narre|transforme|converta)\b/i.test(header)||!/openspeaker|audio|áudio|narra[çc][aã]o/i.test(header))return null
  const match=/\bvoz\s+["“]?(.+?)(?=["”]|\s+e\s+|[,.;]|$)/i.exec(header)
  if(!match)return null
  const body=text.slice(boundary.index+boundary[0].length)
  if(!body.trim())return null
  return {voiceName:match[1].trim(),text:body}
}

export async function startNarrationJob(request,{base=join(root,'.local','telegram','audio-jobs'),requestId='request'}={}) {
  const id=sha(JSON.stringify([request.voiceName.toLowerCase(),request.text])).slice(0,20)+'-'+String(requestId).replace(/[^\w-]/g,'_')
  const folder=join(base,id)
  await mkdir(folder,{recursive:true})
  try {
    const active=JSON.parse(await readFile(join(folder,'runner.lock'),'utf8'))
    try {process.kill(active.pid,0);return {id,folder,pid:active.pid,characters:request.text.length,voice:request.voiceName,reused:true}}
    catch(error){if(error.code!=='ESRCH')throw error}
  }catch(error){if(error.code!=='ENOENT')throw error}
  const input=join(folder,'input.txt');await writeFile(input,request.text,'utf8')
  const out=openSync(join(folder,'runner.log'),'a'),err=openSync(join(folder,'runner-error.log'),'a')
  try {
    const child=spawn(process.execPath,[join(root,'scripts','render-long-audio.mjs'),'--input',input,'--voice',request.voiceName,'--job',folder],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,err]})
    await once(child,'spawn');child.unref()
    return {id,folder,pid:child.pid,characters:request.text.length,voice:request.voiceName}
  }finally{closeSync(out);closeSync(err)}
}

/** Paid work is resumable per part. A retry never regenerates completed recordings. */
export async function renderLongAudio({text,voiceId,voiceName,speed=1,generate,joinParts,
  jobRoot=join(root,'.local','audio-projects'),outputRoot=join(root,'.local','outputs'),cancelled=async()=>false}) {
  const id=sha(JSON.stringify([text,voiceId,speed]))
  const folder=join(jobRoot,id.slice(0,20))
  await mkdir(folder,{recursive:true});await mkdir(outputRoot,{recursive:true})
  const statePath=join(folder,'state.json')
  let state
  try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(state?.status==='ready') {
    const bytes=await readFile(state.output)
    if(sha(bytes)!==state.outputHash)throw Error('Arquivo concluído foi alterado; não foi gerado novamente.')
    return {...state,cached:true}
  }
  state??={id,voiceId,voiceName,speed,sourceHash:sha(text),characters:text.length,parts:[]}
  await writeFile(join(folder,'source.txt'),text,'utf8')
  const chunks=splitNarration(text)
  for(let i=0;i<chunks.length;i++) {
    if(await cancelled())throw Error('Geração interrompida; partes concluídas preservadas.')
    const path=join(folder,'part-'+String(i+1).padStart(4,'0')+'.mp3')
    const previous=state.parts[i]
    if(previous?.status==='ready') {
      const bytes=await readFile(path)
      if(previous.hash!==sha(bytes)||previous.textHash!==sha(chunks[i]))throw Error('Parte concluída foi alterada; geração interrompida.')
      continue
    }
    state.status='generating';state.currentPart=i+1;state.totalParts=chunks.length
    await atomicJson(statePath,state)
    const result=await generate(chunks[i])
    if(audioMime(result.audio)!=='audio/mpeg')throw Error('O fornecedor retornou outro formato; áudio preservado no cache, sem reenvio automático.')
    await writeFile(path,result.audio)
    state.parts[i]={status:'ready',file:path,hash:sha(result.audio),textHash:sha(chunks[i]),taskId:result.taskId,creditCost:result.creditCost??null}
    await atomicJson(statePath,state)
  }
  if(await cancelled())throw Error('Geração interrompida; partes concluídas preservadas.')
  const title=(text.trim().split('\n')[0].slice(0,60)||'Narracao').replace(/[^\p{L}\p{N} ._-]/gu,'_')
  const output=join(outputRoot,title+'-'+id.slice(0,10)+'.mp3')
  state.status='joining';await atomicJson(statePath,state)
  try{await readFile(output);throw Error('Destino existente sem confirmação; preservado para conferência.')}catch(error){if(error.code!=='ENOENT')throw error}
  if(chunks.length===1)await writeFile(output,await readFile(state.parts[0].file))
  else await joinParts(output,state.parts.map(part=>part.file),{title,voiceName})
  const bytes=await readFile(output);audioMime(bytes)
  Object.assign(state,{status:'ready',output,outputHash:sha(bytes),bytes:bytes.length,readyAt:new Date().toISOString()})
  await atomicJson(statePath,state)
  return {...state,cached:false}
}
