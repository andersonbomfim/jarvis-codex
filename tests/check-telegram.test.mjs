import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOwner, splitReply, telegramApi, receiptFor, acknowledgeThenEnqueue, createVoiceSender, resolveTelegramReply, sendTelegramAudio, deliverTelegramAnswer, completionPhrase } from '../bridge/telegram.mjs'
import { speechReply } from '../bridge/speech-reply.mjs'
import {deliverPreparedBriefing,readPreparedBriefing} from '../bridge/telegram-briefing.mjs'
import {isMorningBriefingRequest} from '../shared/reply-policy.mjs'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {interpretTelegramRequest,intentPhrase} from '../bridge/telegram-intent.mjs'

const config={ownerUserId:'123456789',ownerChatId:'123456789'}
const message={from:{id:123456789,is_bot:false},chat:{id:123456789,type:'private'}}
test('only the exact private owner can run commands',()=>{
  assert.equal(isOwner(message,config),true)
  for(const other of [null,{}, {...message,from:{id:9,is_bot:false}}, {...message,chat:{id:123456789,type:'group'}}, {...message,from:{id:123456789,is_bot:true}}, {...message,chat:{id:8,type:'private'}}])assert.equal(isOwner(other,config),false)
})
test('long replies preserve text and do not cut an emoji in half',()=>{
  const text='a'.repeat(3499)+'🤖'+'b'.repeat(4000)
  const parts=splitReply(text)
  assert.equal(parts.join(''),text)
  assert.ok(parts.every(part=>part.length<=3500 && !/[\uD800-\uDBFF]$/.test(part)))
})
test('API failures never expose the bot token',async()=>{
  const token='123456789:'+ 'a'.repeat(35)
  const api=telegramApi(token,async()=>{throw Error('https://api.telegram.org/bot'+token+'/getMe')})
  await assert.rejects(api.call('getMe'),error=>!error.message.includes(token))
})
test('oversized attachments are rejected before downloading',async()=>{
  let requests=0
  const api=telegramApi('123456789:'+ 'a'.repeat(35),async()=>{requests++;return{ok:true,json:async()=>({ok:true,result:{file_size:999,file_path:'documents/test.pdf'}})}})
  await assert.rejects(api.download('file',100),/limite/)
  assert.equal(requests,1)
})

test('the receipt reaches the user before the slow work, and reception does not wait for its completion',async()=>{
  const events=[];let finish
  const slowWork=new Promise(resolve=>{finish=resolve})
  await acknowledgeThenEnqueue({receipt:receiptFor({text:'Coloque uma imagem no atalho Black'}),notify:async text=>{events.push(text)},enqueue:()=>{events.push('work scheduled');return slowWork.then(()=>events.push('final result'))}})
  assert.deepEqual(events,['Um momento, senhor.','work scheduled'])
  finish();await slowWork;await new Promise(resolve=>setImmediate(resolve))
  assert.equal(events.at(-1),'final result')
})

test('a request queued behind another has an honest immediate receipt; a voice file is not declared understood',()=>{
  assert.match(receiptFor({text:'Outro pedido'},1),/pedido anterior/)
  assert.equal(receiptFor({voice:{file_id:'test'}}),null)
  assert.equal(receiptFor({voice:{file_id:'test'}},1),null)
  assert.equal(receiptFor({photo:[]}),null)
})

test('a failed receipt does not lose or replay the accepted task',async()=>{
  let runs=0,errorReported=false
  await acknowledgeThenEnqueue({receipt:'Um momento, senhor.',notify:async()=>{throw Error('offline')},enqueue:()=>{runs++},onReceiptError:()=>{errorReported=true}})
  assert.equal(runs,1);assert.equal(errorReported,true)
})

test('a ready greeting is delivered while a new answer is still being synthesized',async()=>{
  let finish
  const pending=new Promise(resolve=>{finish=resolve})
  const sent=[]
  const speak=createVoiceSender({prepare:text=>text==='long'?pending:Promise.resolve(text),send:async audio=>{sent.push(audio)}})
  const long=speak('long')
  await speak('Para o senhor, sempre.')
  assert.deepEqual(sent,['Para o senhor, sempre.'])
  finish('long audio');await long
  assert.deepEqual(sent,['Para o senhor, sempre.','long audio'])
})

test('cancelled speech is not uploaded after the provider finishes',async()=>{
  let active=true,finish,sends=0
  const pending=new Promise(resolve=>{finish=resolve})
  const speak=createVoiceSender({prepare:()=>pending,send:async()=>{sends++}})
  const job=speak('answer',()=>active)
  active=false;finish('audio');await job
  assert.equal(sends,0)
})

test('the reported voice transcript selects the existing presence clip without a receipt or model call',async()=>{
  const result=await resolveTelegramReply('Jarvis acordado.',{
    beforeWork:async()=>{throw Error('A greeting has no work receipt')},
    ask:async()=>{throw Error('A greeting must not invoke the model')},
  })
  assert.equal(result.fixed.id,'presence')
  assert.equal(result.text,'Para o senhor, sempre.')
})

test('a substantive voice request is acknowledged only after interpretation and then executed once',async()=>{
  const events=['transcribed']
  const result=await resolveTelegramReply('Jarvis acordado. Confira minha agenda.',{
    beforeWork:async()=>{events.push('receipt')},
    ask:async text=>{events.push('work');assert.match(text,/agenda/);return 'A consulta terminou.'},
  })
  assert.equal(result.fixed,null)
  assert.deepEqual(events,['transcribed','receipt','work'])
})

test('presence from an audio transcript uploads the stored MP3 as a voice message without synthesis',async()=>{
  const recording=Buffer.from('ID3-existing-presence-recording')
  const reply=await resolveTelegramReply('Jarvis acordado.',{ask:async()=>{throw Error('No model call')}})
  const audio=await speechReply(reply.text,{
    telegram:true,
    readPreset:async(id,options)=>{assert.equal(id,'presence');assert.equal(options.telegram,true);return recording},
    generate:async()=>{throw Error('No paid synthesis')},
  })
  let uploads=0
  await sendTelegramAudio(async(method,form)=>{
    uploads++;assert.equal(method,'sendVoice');assert.equal(form.get('chat_id'),'123456789')
    assert.deepEqual(Buffer.from(await form.get('voice').arrayBuffer()),recording)
    assert.equal(form.get('voice').type,'audio/mpeg')
    assert.deepEqual(JSON.parse(form.get('reply_parameters')),{message_id:26})
    return {message_id:99,voice:{duration:2}}
  },'123456789',audio,{replyTo:26})
  assert.equal(uploads,1)
})

test('audio requests get a recorded conclusion plus the actual result as text, never synthesized speech',async()=>{
  for(const [audioInput,fixed,expected] of [[false,false,['text']],[false,true,['automatic text']],[true,false,['recorded conclusion','text']],[true,true,['cached voice']]]) {
    const events=[]
    const mode=await deliverTelegramAnswer('answer',{
      audioInput,fixed,
      tell:async()=>events.push('text'),tellAutomatic:async()=>events.push('automatic text'),
      speak:async text=>{assert.equal(text,'Pronto, senhor.');events.push('recorded conclusion')},
      speakAutomatic:async()=>events.push('cached voice'),
    })
    assert.deepEqual(events,expected)
    assert.equal(mode,audioInput?(fixed?'voice':'voice-and-text'):'text')
  }
})

test('recorded conclusions preserve a reported failure or approval requirement',()=>{
  assert.equal(completionPhrase('Senhor, encontrei três documentos.'),'Encontrei o que procurava, senhor.')
  assert.equal(completionPhrase('Não consegui abrir o arquivo.'),'Não consegui concluir essa etapa, senhor.')
  assert.equal(completionPhrase('Preciso da sua aprovação antes de continuar.'),'Preciso da sua confirmação, senhor.')
  assert.equal(completionPhrase('Não encontrei esse arquivo.'),'Encontrei um impedimento, senhor.')
})

test('a voice request is interpreted, acknowledged with a recording, executed, then concluded with recording and text',async()=>{
  const events=['interpreted']
  const result=await resolveTelegramReply('Pesquise o clima de São Paulo.',{
    beforeWork:async()=>{events.push('recorded acknowledgement')},
    ask:async()=>{events.push('work');return 'Encontrei a previsão solicitada.'},
  })
  await deliverTelegramAnswer(result.text,{
    audioInput:true,fixed:Boolean(result.fixed),
    speak:async text=>{assert.equal(text,'Encontrei o que procurava, senhor.');events.push('recorded conclusion')},
    tell:async text=>{assert.equal(text,result.text);events.push('result as text')},
  })
  assert.deepEqual(events,['interpreted','recorded acknowledgement','work','recorded conclusion','result as text'])
})

test('receipts follow the interpreted request instead of rotating received/checking phrases',()=>{
  for(let sequence=0;sequence<6;sequence++)assert.equal(receiptFor({text:'Faça essa alteração'},0,sequence),'Um momento, senhor.')
  assert.equal(receiptFor({text:'Confira minha agenda'}),'Vou verificar sua agenda, senhor.')
  assert.equal(receiptFor({text:'Veja meus emails'}),'Vou consultar seus e-mails, senhor.')
  assert.equal(receiptFor({text:'Pesquise isso'}),'Vou consultar para o senhor e já volto com a resposta.')
  assert.equal(receiptFor({text:'Confira a agenda e os emails'}),'Um momento, senhor.')
})

test('natural briefing commands bypass text receipts even when queued; unrelated news requests do not',()=>{
  for(const text of ['Leia meu briefing de hoje','Olá, Jarvis. Me diga o briefing de hoje.','Jarvis, pode ler o meu briefing para mim?','Envie o briefing matinal','/briefing','Me mande o resumo do dia, por favor']) {
    assert.equal(isMorningBriefingRequest(text),true,text)
    assert.equal(receiptFor({text},2),null,text)
  }
  for(const text of ['Olá, Jarvis. Diga no Brasil de hoje.','Pesquise as notícias do Brasil de hoje','Revise esse briefing','Leia o briefing de ontem','Gere outro briefing sobre o livro'])assert.equal(isMorningBriefingRequest(text),false,text)
  assert.notEqual(receiptFor({text:'Leia meu briefing de hoje',forward_origin:{type:'user'}}),null)
})

test('audio or text briefing requests upload one existing voice message, no clips or duplicate narration',async()=>{
  const recording=Buffer.from('ID3-existing-full-briefing')
  for(const text of ['Leia meu briefing de hoje','Olá Jarvis me diga o briefing matinal']) {
    const calls=[]
    const result=await deliverPreparedBriefing(text,{
      replyTo:37,read:async()=>({date:'2026-10-20',status:'ready',audio:recording,taskId:'already-paid'}),
      tell:async()=>{throw Error('No acknowledgement, completion or duplicate written briefing')},
      send:(audio,options)=>sendTelegramAudio(async(method,form)=>{
        calls.push(method);assert.deepEqual(Buffer.from(await form.get('voice').arrayBuffer()),recording)
        assert.equal(JSON.parse(form.get('reply_parameters')).message_id,37)
        return {message_id:100}
      },'123456789',audio,options),
    })
    assert.deepEqual(calls,['sendVoice']);assert.equal(result.status,'sent');assert.equal(result.messageId,100)
  }
})

test('unavailable briefing is reported once without a recording, retry, model or synthesis',async()=>{
  const messages=[]
  const result=await deliverPreparedBriefing('Leia o briefing',{
    read:async()=>({date:'2026-10-20',status:'unavailable'}),
    send:async()=>{throw Error('Do not send any audio')},tell:async text=>messages.push(text),
  })
  assert.equal(result.status,'unavailable');assert.equal(messages.length,1);assert.match(messages[0],/ainda não está pronto/)
  let reads=0
  assert.equal(await deliverPreparedBriefing('Leia o briefing',{eligible:false,read:async()=>{reads++}}),null)
  assert.equal(await deliverPreparedBriefing('Pesquise política',{read:async()=>{reads++}}),null)
  assert.equal(reads,0)
})

test('briefing delivery never falls back to yesterday or ignores mismatched date or unreadable audio',async()=>{
  const testsRoot=join(import.meta.dirname,'..','.local','tests')
  await mkdir(testsRoot,{recursive:true})
  const directoryRoot=await mkdtemp(join(testsRoot,'telegram-briefing-'))
  const now=new Date('2026-10-21T01:00:00Z') // Still October 20 in São Paulo.
  const folder=join(directoryRoot,'2026-10-20');await mkdir(folder)
  const state=join(folder,'audio-state.json'),audio=join(folder,'briefing.audio')
  const recording=Buffer.from('ID3-accepted-briefing')
  await writeFile(state,JSON.stringify({status:'ready',date:'2026-10-20',taskId:'accepted'}));await writeFile(audio,recording)
  const ready=await readPreparedBriefing({directoryRoot,now,timezone:'America/Sao_Paulo'})
  assert.equal(ready.status,'ready');assert.deepEqual(ready.audio,recording)
  assert.equal((await readPreparedBriefing({directoryRoot,now:new Date('2026-10-21T04:00:00Z'),timezone:'America/Sao_Paulo'})).status,'unavailable')
  await writeFile(state,JSON.stringify({status:'ready',date:'2026-10-19'}))
  assert.equal((await readPreparedBriefing({directoryRoot,now,timezone:'America/Sao_Paulo'})).status,'unavailable')
  await writeFile(state,JSON.stringify({status:'ready',date:'2026-10-20'}));await writeFile(audio,'not audio')
  await assert.rejects(readPreparedBriefing({directoryRoot,now,timezone:'America/Sao_Paulo'}))
})

test('cancellation after reading the cached briefing prevents upload and text',async()=>{
  const result=await deliverPreparedBriefing('Leia o briefing',{
    read:async()=>({date:'2026-10-20',status:'ready',audio:Buffer.from('ID3-existing')}),isCurrent:()=>false,
    send:async()=>{throw Error('Cancelled')},tell:async()=>{throw Error('Cancelled')},
  })
  assert.equal(result.status,'cancelled')
})

test('a paraphrase without a briefing keyword is interpreted with context before selecting a recording',async()=>{
  const text='Pode colocar aquilo para tocar para mim?'
  assert.equal(isMorningBriefingRequest(text),false)
  const context=[{role:'jarvis',text:'O áudio que preparei para sua manhã já está pronto.'}]
  const intent=await interpretTelegramRequest(text,{context,infer:async data=>{
    assert.equal(data.message,text);assert.deepEqual(data.context,context)
    return JSON.stringify({route:'briefing',presetId:null})
  }})
  const calls=[]
  await deliverPreparedBriefing(text,{intent,read:async()=>({date:'2026-10-20',status:'ready',audio:Buffer.from('ID3-existing')}),
    send:async()=>{calls.push('existing briefing');return {message_id:99}},tell:async()=>{throw Error('No duplicate text or receipts')},
  })
  assert.deepEqual(calls,['existing briefing'])
})

test('interpreted meaning selects an appropriate acknowledgement without a literal keyword match',async()=>{
  const intent=await interpretTelegramRequest('Tenho alguma coisa marcada para esta tarde?',{
    infer:async()=>JSON.stringify({route:'work',presetId:'calendar'}),
  })
  assert.equal(intent.route,'work');assert.equal(intentPhrase(intent),'Vou verificar sua agenda, senhor.')
})

test('an unintelligible transcript asks for clarification instead of treating Brasil as briefing',async()=>{
  const intent=await interpretTelegramRequest('Olá Jarvis diga no Brasil de hoje',{
    infer:async()=>JSON.stringify({route:'clarify',presetId:'repeat'}),
  })
  assert.equal(intent.route,'clarify');assert.equal(intentPhrase(intent),'Não entendi o pedido. Pode repetir, senhor?')
})

test('greetings and explicit briefing commands use ready routes without an additional inference',async()=>{
  const infer=async()=>{throw Error('No unnecessary model call')}
  assert.equal((await interpretTelegramRequest('Bom dia, Jarvis.',{infer})).route,'social')
  assert.equal((await interpretTelegramRequest('Leia o briefing de hoje',{infer})).route,'briefing')
  assert.equal((await interpretTelegramRequest('Leia o briefing',{eligible:false,infer})).route,'work')
})

test('invalid interpretation never starts work or turns an arbitrary model reply into a preset',async()=>{
  for(const raw of ['Entendido, senhor.','{"route":"work","presetId":"received"}','{"route":"social","presetId":"ready"}']) {
    await assert.rejects(interpretTelegramRequest('pedido não literal',{infer:async()=>raw}),/interpret|conclusiva/)
  }
})
