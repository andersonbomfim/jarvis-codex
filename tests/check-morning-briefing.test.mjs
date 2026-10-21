import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createOpenSpeakerClient } from '../bridge/openspeaker-speech.mjs'
import { createMorningBriefingRoute, morningDate } from '../bridge/morning-briefing.mjs'

const root = join(import.meta.dirname, '..', '.local', 'tests')
await mkdir(root, { recursive: true })
// Synthetic container fixture: no recording, synthesis, playback or provider call.
const wave = Buffer.alloc(48);wave.write('RIFF');wave.write('WAVE',8)
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
const cache = () => mkdtemp(join(root, 'openspeaker-'))

test('one whole reply, one charged submission, credential stays off the CDN, persistent cache', async () => {
  const directory = await cache()
  let posts = 0, polls = 0
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/v3/text-to-speech')) {
      posts++
      assert.equal(options.body.get('text'), 'Bom dia. Seu briefing está pronto.')
      assert.equal(options.body.get('voice_id'), 'clone_test')
      assert.equal(options.headers['xi-api-key'], 'test-only-not-a-real-key')
      return json({ success: true, task_id: 'task-test' })
    }
    if (url.includes('/v1/task/')) {
      polls++
      return json(polls === 1 ? { status: 'doing' } : { status: 'done', credit_cost: 17, metadata: { audio_url: 'https://audio.example.invalid/clip.wav' } })
    }
    assert.equal(options.headers, undefined)
    return new Response(wave)
  }
  const client = createOpenSpeakerClient({ apiKey: 'test-only-not-a-real-key', voiceId: 'clone_test', cacheDir: directory, fetchImpl, wait: async () => {} })
  const [a,b] = await Promise.all([client.generate('Bom dia. Seu briefing está pronto.'), client.generate('Bom dia. Seu briefing está pronto.')])
  assert.equal(posts, 1); assert.equal(a.creditCost, 17); assert.deepEqual(a.audio, wave); assert.deepEqual(b.audio, wave)
  const restarted = createOpenSpeakerClient({ apiKey: 'test-only-not-a-real-key', voiceId: 'clone_test', cacheDir: directory, fetchImpl: async () => { throw new Error('Cache hit must not call the provider') } })
  assert.equal((await restarted.generate('Bom dia. Seu briefing está pronto.')).cached, true)
})

test('a failed status query resumes the existing paid task', async () => {
  let posts = 0, broken = true
  const client = createOpenSpeakerClient({ apiKey: 'test', voiceId: 'clone_test', cacheDir: await cache(), fetchImpl: async (url) => {
    if (url.endsWith('/v3/text-to-speech')) { posts++; return json({ success: true, task_id: 'existing-task' }) }
    if (url.includes('/v1/task/')) { if (broken) { broken = false; throw new Error('test connection failure') }; return json({ status: 'done', metadata: { audio_url: 'https://audio.example.invalid/clip.wav' } }) }
    return new Response(wave)
  } })
  assert.deepEqual((await client.generate('Usuário, sua agenda está pronta.')).audio, wave)
  assert.deepEqual((await client.generate('Usuário, sua agenda está pronta.')).audio, wave)
  assert.equal(posts, 1)
})

test('two independent clients sharing storage submit the same text only once', async () => {
  let posts = 0
  const cacheDir = await cache()
  const fetchImpl = async url => {
    if (url.endsWith('/v3/text-to-speech')) { posts++; await new Promise(resolve => setTimeout(resolve, 25)); return json({ success: true, task_id: 'shared-task' }) }
    if (url.includes('/v1/task/')) return json({ status: 'done', metadata: { audio_url: 'https://audio.example.invalid/clip.wav' } })
    return new Response(wave)
  }
  const options = { apiKey: 'test', voiceId: 'clone_test', cacheDir, fetchImpl, wait: () => new Promise(resolve => setTimeout(resolve, 10)) }
  const clients = [createOpenSpeakerClient(options), createOpenSpeakerClient(options)]
  const results = await Promise.all(clients.map(client => client.generate('Para o senhor, sempre.')))
  assert.equal(posts, 1)
  assert.deepEqual(results[0].audio, results[1].audio)
})

test('ambiguous submission never silently charges twice', async () => {
  let posts = 0
  const client = createOpenSpeakerClient({ apiKey: 'test', voiceId: 'clone_test', cacheDir: await cache(), fetchImpl: async (url, options) => { if(options?.method === 'POST') {posts++; throw new Error('submission connection lost')}; return json({data:[]}) } })
  await assert.rejects(client.generate('Bom dia.'), /connection lost/)
  await assert.rejects(client.generate('Bom dia.'), /Confirmação|confirmação/)
  assert.equal(posts, 1)
})

test('503 after acceptance recovers the same task by exact text, voice and time, without a second charge', async () => {
  let posts = 0
  const clock = Date.parse('2026-10-19T22:00:00Z')
  const text = 'Para o senhor, sempre.'
  const client = createOpenSpeakerClient({ apiKey:'test', voiceId:'clone_test', cacheDir:await cache(), now:()=>clock, fetchImpl:async (url, options) => {
    if(options?.method === 'POST') { posts++; return new Response('', {status:503}) }
    if(url.includes('/v1/tasks?')) return json({data:[
      {id:'wrong-voice',text,created_at:new Date(clock).toISOString(),metadata:{v3:{raw_voice_id:'clone_other'}}},
      {id:'accepted-once',text,created_at:new Date(clock+1000).toISOString(),metadata:{v3:{raw_voice_id:'clone_test'}}},
    ]})
    if(url.includes('/v1/task/accepted-once')) return json({status:'done',metadata:{audio_url:'https://audio.example.invalid/clip.wav'}})
    return new Response(wave)
  } })
  assert.deepEqual((await client.generate(text)).audio,wave)
  assert.equal(posts,1)
})

test('ambiguous matching tasks never trigger another paid submission', async () => {
  let posts = 0
  const clock = Date.parse('2026-10-19T22:00:00Z')
  const client = createOpenSpeakerClient({apiKey:'test',voiceId:'clone_test',cacheDir:await cache(),now:()=>clock,fetchImpl:async (url,options)=>{
    if(options?.method==='POST'){posts++;return new Response('',{status:503})}
    return json({data:['a','b'].map(id=>({id,text:'Obrigado.',created_at:new Date(clock).toISOString(),metadata:{v3:{raw_voice_id:'clone_test'}}}))})
  }})
  await assert.rejects(client.generate('Obrigado.'),/503/)
  await assert.rejects(client.generate('Obrigado.'),/confirmação/)
  assert.equal(posts,1)
})

test('does not swap a clone for an inexpensive generic voice or truncate text', async () => {
  assert.throws(() => createOpenSpeakerClient({ apiKey: 'test', voiceId: 'edge_pt-BR-AntonioNeural' }), /clone_/)
  const client = createOpenSpeakerClient({ apiKey: 'test', voiceId: 'clone_test' })
  await assert.rejects(client.generate('a'.repeat(10001)), /10.000/)
})

test('São Paulo day boundary is independent of UTC', () => {
  assert.equal(morningDate(new Date('2026-10-17T01:30:00Z'),'America/Sao_Paulo'), '2026-10-16')
})

async function call(route, url, method='GET') {
  let status, body
  const res = { writeHead(value) { status=value }, end(value) { body=value } }
  await route({ url, method }, res, {})
  return { status, body: JSON.parse(body) }
}

test('ready morning audio stays silent at all hours and remains available on request', async () => {
  const directoryRoot = await cache()
  await mkdir(join(directoryRoot, '2026-10-17'))
  await writeFile(join(directoryRoot, '2026-10-17', 'briefing.txt'), 'Bom dia, senhor.')
  await writeFile(join(directoryRoot, '2026-10-17', 'audio-state.json'), JSON.stringify({date:'2026-10-17',status:'ready'}))
  await writeFile(join(directoryRoot, '2026-10-17', 'briefing.audio'), wave)
  let now = new Date('2026-10-17T09:59:59Z')
  const route = createMorningBriefingRoute({ timezone:'America/Sao_Paulo', directoryRoot, now: () => now })
  assert.equal((await call(route, '/morning-briefing')).body.due, false)
  assert.equal((await call(route, '/morning-briefing/claim?date=2026-10-17','POST')).status, 409)
  for(const hour of ['09:55:00','10:00:00','10:10:55','10:30:00','15:00:00']) {
    now = new Date('2026-10-17T'+hour+'Z')
    const briefing = (await call(route,'/morning-briefing')).body
    assert.equal(briefing.due,false)
    assert.equal(briefing.playbackMode,'on_request')
    assert.equal(briefing.audioUrl,'/morning-briefing/audio?date=2026-10-17')
    assert.equal((await call(route,'/morning-briefing/claim?date=2026-10-17','POST')).status,409)
  }
  let downloaded
  const response={writeHead(status){assert.equal(status,200)},end(bytes){downloaded=bytes}}
  await route({url:'/morning-briefing/audio?date=2026-10-17',method:'GET'},response,{})
  assert.deepEqual(downloaded,wave)
  assert.equal((await call(route, '/morning-briefing/audio?date=2026-10-16')).status, 400)
  await assert.rejects(readFile(join(directoryRoot,'2026-10-17','delivery.json')), {code:'ENOENT'})
})

test('an old automatic player cannot reserve, renew or retry a briefing',async()=>{
 const directoryRoot=await cache();await mkdir(join(directoryRoot,'2026-10-17'));await writeFile(join(directoryRoot,'2026-10-17','briefing.txt'),'Bom dia.')
 let now=new Date('2026-10-17T10:00:00Z');const route=createMorningBriefingRoute({timezone:'America/Sao_Paulo',directoryRoot,now:()=>now})
 await writeFile(join(directoryRoot,'2026-10-17','delivery.json'),JSON.stringify({status:'playing',token:'old-token',leaseUntil:'2026-10-17T10:01:30Z'}))
 assert.equal((await call(route,'/morning-briefing/heartbeat?date=2026-10-17&token=old-token','POST')).status,409)
 assert.equal((await call(route,'/morning-briefing/finished?date=2026-10-17&token=wrong-token&status=played','POST')).status,409)
 await call(route,'/morning-briefing/finished?date=2026-10-17&token=old-token&status=cancelled','POST')
 const state=JSON.parse(await readFile(join(directoryRoot,'2026-10-17','delivery.json'),'utf8'))
 assert.equal(state.status,'cancelled');assert.equal(state.retryAt,null)
 assert.equal((await call(route,'/morning-briefing/claim?date=2026-10-17','POST')).status,409)
 now=new Date('2026-10-17T10:30:00Z')
 assert.equal((await call(route,'/morning-briefing/claim?date=2026-10-17','POST')).status,409)
})
