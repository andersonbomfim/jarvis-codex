import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import presets from '../shared/voice-presets.json' with {type:'json'}
import {quickReplyFor} from '../shared/quick-replies.mjs'
import {completionPhrase,isMorningBriefingRequest} from '../shared/reply-policy.mjs'

const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8')
const tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
function callback(name,context){
 let initializer
 const walk=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)initializer=node.initializer;ts.forEachChild(node,walk)}
 walk(tree);assert.ok(initializer,name)
 const js=ts.transpileModule('globalThis.callback = '+initializer.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const sandbox=vm.createContext(context);vm.runInContext(js,sandbox);return sandbox.callback
}
function fixture(ask,fetchBriefing,{route='work',presetId='one-moment',audio=true,played=true}={}){
 const events=[],turn={current:0},state={phase:'dormant',turns:[],error:null,
  clearPanels(){},clearBlades(){},setCaption(){},setActiveTool(){},
  pushTurn(t){this.turns.push(t)},appendToLastTurn(text){this.turns.at(-1).text+=text},
  setPhase(phase){this.phase=phase},setError(error){this.error=error}}
 const speaker={say:text=>events.push(['voice',text]),clip:(url,text)=>events.push(['existing-audio',url,text]),clipCompleted:()=>played,push:()=>{throw Error('No synthesized conversational narration')},async end(){events.push(['audio-ended'])}}
 const fetch=async(url,options)=>url.endsWith('/assistant/interpret')?{ok:true,json:async()=>({route,presetId})}:fetchBriefing(url,options)
 const context={turn,clearIdle(){},store:{getState:()=>state},newId:()=>String(state.turns.length),
  createSpeaker:()=>speaker,speaker:{current:null},voice:{current:null},history:{current:[]},
  sfx:{duck(){},play(){}},music:{duck(){},working(){}},fixedReplyFor:quickReplyFor,
  broadPoliticsScope:()=>null,acknowledgementFor:()=>null,audioEnabled:()=>audio,
  phrase:id=>presets.find(p=>p.id===id).text,completionPhrase,isMorningBriefingRequest,usingBridge:true,fetch,BRIDGE_HTTP_URL:'http://127.0.0.1:8787',AbortSignal,
  ask:async(...args)=>{events.push(['work']);return ask(...args)},
  console:{error(){}},Error,previewingVoice:{current:false},
  silence(){events.push(['pause-output'])},interrupt(){events.push(['interrupt'])},
  listen(){},FOLLOW_UP_MS:10000}
 return {events,turn,state,respond:callback('respond',context),noise:callback('onSpeechStart',context)}
}
test('noise cannot cancel work; completion follows the receipt and actual result without new TTS',async()=>{
 let finish
 const f=fixture(async(_text,_history,handlers)=>{await new Promise(resolve=>{finish=resolve});handlers.onText('Encontrei o arquivo solicitado.');return{text:'Encontrei o arquivo solicitado.'}})
 const pending=f.respond('Encontre o arquivo de teste')
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(f.events[0][0],'voice');assert.equal(f.events[1][0],'work')
 const turn=f.turn.current
 f.noise();assert.equal(f.turn.current,turn);assert.equal(f.state.phase,'thinking')
 assert.equal(f.events.some(e=>e[0]==='interrupt'),false)
 assert.equal(f.events.some(e=>e[0]==='pause-output'),false)
 finish();await pending
 assert.equal(f.state.turns.at(-1).text,'Encontrei o arquivo solicitado.')
 assert.equal(f.events.filter(e=>e[0]==='voice').at(-1)[1],completionPhrase('Encontrei o arquivo solicitado.'))
})

test('a naturally phrased desktop briefing request plays the stored audio without ordinary work or receipts',async()=>{
 const f=fixture(()=>{throw Error('Do not ask the work agent to rewrite the briefing')},async()=>({ok:true,json:async()=>({text:'Bom dia, senhor. Seu dia está preparado.',status:'ready',audioUrl:'/morning-briefing/audio?date=2026-10-20'})}),{route:'briefing',presetId:null})
 await f.respond('Me conta o que você preparou para a minha manhã')
 assert.equal(f.events.filter(event=>event[0]==='existing-audio').length,1)
 assert.equal(f.events.some(event=>['voice','work'].includes(event[0])),false)
 assert.equal(f.state.error,null)
})

test('a requested briefing plays even when ordinary responses are configured as text',async()=>{
 const f=fixture(()=>{throw Error('No work')},async()=>({ok:true,json:async()=>({text:'Bom dia.',status:'ready',audioUrl:'/morning-briefing/audio?date=2026-10-20'})}),{audio:false})
 await f.respond('Leia meu briefing de hoje')
 assert.equal(f.events.filter(event=>event[0]==='existing-audio').length,1)
})

test('an unavailable briefing or failed playback is reported as a failure, never a success clip',async()=>{
 for(const ready of [false,true]){
  const f=fixture(()=>{throw Error('No work')},async()=>({ok:true,json:async()=>({text:'Bom dia.',status:ready?'ready':'waiting',audioUrl:ready?'/morning-briefing/audio?date=2026-10-20':null})}),{played:false})
  await f.respond('Leia meu briefing de hoje')
  assert.match(f.state.error,/áudio|reprodução/)
  assert.equal(f.events.some(event=>event[0]==='voice'&&event[1]===presets.find(item=>item.id==='ready').text),false)
 }
})
test('a presence question has one cached answer and bypasses work entirely',async()=>{
 const f=fixture(()=>{throw Error('A greeting must not invoke the model')})
 await f.respond('Você está aí?')
 assert.deepEqual(f.events.filter(e=>e[0]==='voice'),[['voice','Para o senhor, sempre.']])
 assert.equal(f.events.some(e=>e[0]==='work'),false)
})
test('a failed request gets the cached failure clip and no success claim',async()=>{
 const f=fixture(async()=>{throw Error('Falha controlada')})
 await f.respond('Faça a tarefa de teste')
 assert.equal(f.state.error,'Falha controlada')
 assert.equal(f.events.filter(e=>e[0]==='voice').at(-1)[1],presets.find(p=>p.id==='failed').text)
})
test('an explicit briefing request reads the prepared audio once without model work or synthesis',async()=>{
 const f=fixture(()=>{throw Error('Must not regenerate the briefing')},async()=>({ok:true,json:async()=>({text:'Bom dia, senhor. Sua agenda de hoje está confirmada.',status:'ready',audioUrl:'/morning-briefing/audio?date=2026-10-20'})}))
 await f.respond('Leia meu briefing de hoje')
 const clips=f.events.filter(e=>e[0]==='existing-audio')
 assert.equal(clips.length,1)
 assert.equal(clips[0][1],'http://127.0.0.1:8787/morning-briefing/audio?date=2026-10-20')
 assert.equal(f.events.some(e=>e[0]==='work'||e[0]==='voice'),false)
 assert.equal(f.state.turns.at(-1).text,'Bom dia, senhor. Sua agenda de hoje está confirmada.')
 for(const text of ['resuma este novo livro','pesquise as notícias sobre o relatório de hoje','bom dia'])assert.equal(isMorningBriefingRequest(text),false)
})

test('a pergunta na escuta recebe a gravação de presença sem trabalho nem interpretação adicional',async()=>{
 for(const text of ['na escuta','você está na escuta?','está na escuta?','Jarvis, na escuta?']){
  const f=fixture(()=>{throw Error('Uma chamada de presença não é uma tarefa')})
  await f.respond(text)
  assert.deepEqual(f.events.filter(event=>event[0]==='voice'),[['voice','Para o senhor, sempre.']])
  assert.equal(f.events.some(event=>event[0]==='work'),false)
 }
})
