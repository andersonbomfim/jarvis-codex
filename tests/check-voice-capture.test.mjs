import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
const source=await readFile(new URL('../src/lib/voice.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')
const context=vm.createContext({})
vm.runInContext(js+'\nglobalThis.route=transcriptRoute;',context)
const route=context.route

test('a fala captada em repouso não vira comando porque a transcrição chegou em outra fase',()=>{
 assert.equal(route('Obrigado.','wake',false,'','command',''),'wake')
 assert.equal(route('Jarvis, abra a agenda.','wake',false,'','command',''),'wake')
 assert.equal(route('O que é isso?','command',false,'','wake',''),'wake')
})
test('o eco continua bloqueado mesmo depois que a reprodução termina',()=>{
 assert.equal(route('A sua agenda está pronta para hoje.','guard',true,'A sua agenda está pronta para hoje.','command',''),'echo')
 assert.equal(route('Obrigado.','guard',true,'Bom dia, senhor.','command',''),'playback-without-wake')
 assert.equal(route('Jarvis, pare por favor.','guard',true,'Bom dia, senhor.','guard','Bom dia, senhor.'),'wake')
})
test('a conversa normal continua livre depois da fala e uma sessão inativa descarta respostas atrasadas',()=>{
 assert.equal(route('Obrigado.','command',false,'','command',''),'command')
 assert.equal(route('Mostre minha agenda.','command',false,'','deaf',''),'inactive')
 assert.equal(route('Jarvis.','deaf',false,'','command',''),'inactive')
})

test('a sessão real descarta transcrição atrasada após parar e mantém a referência de eco da captura',async()=>{
 for(const scenario of ['stopped','echo','changed-mode']){
  let handlers,complete,mode=scenario==='changed-mode'?'wake':'guard',playing=scenario==='echo',spoken=playing?'Sua agenda está pronta.':'',accepted=0
  const sandbox=vm.createContext({console,performance,AbortSignal,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
   speakingNow:()=>spoken,speakingSince:()=>playing?Date.now()-1000:0,audioPlaying:()=>playing,BRIDGE_HTTP_URL:'http://test',
   fetch:async()=>new Promise(resolve=>{complete=()=>resolve({ok:true,json:async()=>({text:scenario==='echo'?'Sua agenda está pronta.':'Obrigado.'})})}),
   startVad:async h=>{handlers=h;return {live:()=>true,meter:()=>({speaking:false}),setGuard(){},stop(){}}}})
  vm.runInContext(js+'\nglobalThis.startLoop=startElevenVoice;',sandbox)
  const loop=await sandbox.startLoop({mode:()=>mode,onUtterance(){accepted++},onWake(){accepted++},onSpeechStart(){},onPartial(){},onError(){}})
  try{
   handlers.onStart();handlers.onEnd({type:'audio/webm',size:1000})
   mode='command';playing=false;spoken=''
   if(scenario==='stopped')loop.stop()
   complete();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))
   assert.equal(accepted,0,scenario)
  }finally{loop.stop()}
 }
})
