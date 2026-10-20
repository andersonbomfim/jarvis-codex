import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {splitNarration,narrationRequest,prepareLongRequest,renderLongAudio} from '../bridge/long-work.mjs'
const tests=join(import.meta.dirname,'..','.local','tests')
await mkdir(tests,{recursive:true})
const fixture=async()=>{const folder=await mkdtemp(join(tests,'long-work-'));return {folder,jobRoot:join(folder,'jobs'),outputRoot:join(folder,'out')}}
const mp3=Buffer.from('ID3-test-recording')

test('long writing survives chunk boundaries, accents, emoji and paragraphs without dropping a character',()=>{
  const text=('Capítulo: ação, memória e propósito. 😀\n\nOutro parágrafo da história.\n').repeat(1000)
  const parts=splitNarration(text)
  assert.equal(parts.join(''),text);assert.ok(parts.length>5)
  assert.ok(parts.every(part=>part.length<=9000&&!/[\uD800-\uDBFF]$/.test(part)))
})

test('the explicit narration request selects the requested voice and keeps the full body',()=>{
  const result=narrationRequest('Gere para mim no OpenSpeaker esse texto com a voz GOT e me entregue o áudio baixado aqui por favor\n\nSOPHIA\n\nTexto do capítulo.')
  assert.equal(result.voiceName,'GOT');assert.equal(result.text,'SOPHIA\n\nTexto do capítulo.')
  assert.equal(narrationRequest('SOPHIA\n\n— Gere um áudio, disse o personagem.'),null)
})

test('a manuscript above the old limit is stored intact while model history uses a concise file reference',async()=>{
  const {folder}=await fixture();const text='Revise somente a ortografia.\n\n'+('Um parágrafo autoral.\n').repeat(2000)
  const prepared=await prepareLongRequest(text,{messageId:123,inbox:folder})
  assert.equal(await readFile(prepared.file,'utf8'),text)
  assert.ok(prepared.prompt.length<3000);assert.ok(prepared.historyText.length<2000)
  assert.ok(!prepared.prompt.includes('divida o pedido'))
})

test('interrupted multi-part work resumes completed parts and produces exactly one final artifact',async()=>{
  const paths=await fixture();const text=('Um período inteiro com palavras próprias.\n\n').repeat(1000)
  const total=splitNarration(text).length
  let calls=0,joins=0
  const common={...paths,text,voiceId:'clone_fixture',voiceName:'Teste',joinParts:async(output,parts)=>{joins++;assert.equal(parts.length,total);await writeFile(output,mp3)}}
  await assert.rejects(renderLongAudio({...common,generate:async()=>{if(++calls===2)throw Error('Interrupted');return {audio:mp3,taskId:'first'}}}),/Interrupted/)
  calls=0
  const result=await renderLongAudio({...common,generate:async()=>{calls++;return {audio:mp3,taskId:'resumed'}}})
  assert.equal(calls,total-1);assert.equal(joins,1);assert.equal(result.status,'ready')
  const cached=await renderLongAudio({...common,generate:async()=>{throw Error('Must not charge again')}})
  assert.equal(cached.cached,true);assert.equal(joins,1);assert.equal(cached.output,result.output)
})

test('cancelled manuscript work cannot submit a new generation',async()=>{
  const paths=await fixture();let submissions=0
  await assert.rejects(renderLongAudio({...paths,text:'Um texto.',voiceId:'clone_fixture',voiceName:'Teste',cancelled:async()=>true,generate:async()=>{submissions++}}),/interrompida/)
  assert.equal(submissions,0)
})
