import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createTelegramMorningDelivery} from '../bridge/telegram-morning-delivery.mjs'

const date='2026-10-22',audio=Buffer.from('ID3-already-generated-briefing')
async function fixture(overrides={}) {
  const tests=join(import.meta.dirname,'..','.local','tests')
  await mkdir(tests,{recursive:true})
  const directoryRoot=await mkdtemp(join(tests,'telegram-auto-briefing-'))
  let uploads=0
  const dependencies={directoryRoot,timezone:'America/Sao_Paulo',now:()=>new Date('2026-10-22T09:55:00Z'),
    readSettings:async()=>({telegramDelivery:{enabled:true}}),
    read:async()=>({date,status:'ready',taskId:'same-accepted-task',audio}),
    send:async received=>{assert.deepEqual(received,audio);uploads++;return {message_id:78}},
    ...overrides,
  }
  return {directoryRoot,dependencies,run:createTelegramMorningDelivery(dependencies),uploads:()=>uploads,
    receipt:()=>readFile(join(directoryRoot,date,'telegram-delivery.json'),'utf8').then(JSON.parse)}
}

test('ready audio is sent once; polling and restarting cannot upload it again',async()=>{
  const f=await fixture()
  const sent=await f.run()
  assert.equal(sent.status,'sent');assert.equal(sent.messageId,78)
  assert.equal((await f.run()).status,'sent')
  assert.equal((await createTelegramMorningDelivery(f.dependencies)()).status,'sent')
  assert.equal(f.uploads(),1);assert.equal((await f.receipt()).taskId,'same-accepted-task')
})

test('a manually delivered briefing is recorded without reading or uploading another audio',async()=>{
  const f=await fixture({manualDelivery:()=>({date,status:'sent',taskId:'accepted',messageId:55}),
    read:async()=>{throw Error('Already delivered manually')}})
  assert.equal((await f.run()).source,'manual');assert.equal(f.uploads(),0)
  assert.equal((await f.receipt()).messageId,55)
})

test('disabled delivery does not read or send the briefing',async()=>{
  const f=await fixture({readSettings:async()=>({telegramDelivery:{enabled:false}}),read:async()=>{throw Error('Disabled')}})
  assert.equal((await f.run()).status,'disabled');assert.equal(f.uploads(),0)
})

test('a pending audio is checked again later without generating or sending substitutes',async()=>{
  let ready=false
  const f=await fixture({read:async()=>({date,status:ready?'ready':'unavailable',audio})})
  assert.equal((await f.run()).status,'waiting');assert.equal(f.uploads(),0)
  ready=true;assert.equal((await f.run()).status,'sent');assert.equal(f.uploads(),1)
})

test('yesterday or tomorrow cannot be automatically delivered as today',async()=>{
  for(const other of ['2026-10-21','2026-10-23']) {
    const f=await fixture({read:async()=>({date:other,status:'ready',audio})})
    assert.equal((await f.run()).status,'expired');assert.equal(f.uploads(),0)
  }
})

test('a send with uncertain acceptance is not repeated after a restart',async()=>{
  let attempts=0
  const f=await fixture({send:async()=>{attempts++;throw Error('Connection lost after upload')}})
  await assert.rejects(f.run(),/Connection lost/)
  assert.equal((await f.receipt()).status,'uncertain')
  assert.equal((await createTelegramMorningDelivery(f.dependencies)()).status,'uncertain')
  assert.equal(attempts,1)
})

test('concurrent checks can claim only one upload',async()=>{
  const f=await fixture()
  await Promise.all([f.run(),createTelegramMorningDelivery(f.dependencies)()])
  assert.equal(f.uploads(),1)
})

test('a saved in-flight receipt is preserved rather than resent',async()=>{
  const f=await fixture()
  await mkdir(join(f.directoryRoot,date))
  await writeFile(join(f.directoryRoot,date,'telegram-delivery.json'),JSON.stringify({date,status:'sending'}))
  assert.equal((await f.run()).status,'sending');assert.equal(f.uploads(),0)
})

test('automatic delivery uses the personal timezone rather than a fixed country',async()=>{
  const f=await fixture({timezone:'Asia/Tokyo',now:()=>new Date('2026-10-21T15:30:00Z')})
  assert.equal((await f.run()).status,'sent');assert.equal(f.uploads(),1)
})
