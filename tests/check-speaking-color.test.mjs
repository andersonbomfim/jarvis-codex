import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
const source=await readFile(new URL('../src/ui/wave-ring.ts',import.meta.url),'utf8')
const context=vm.createContext({exports:{}})
vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
const {voiceSignal,VOICE_COLORS}=context.exports

test('a resposta do Jarvis tem prioridade sobre um microfone alto e usa vermelho',()=>{
 for(const phase of ['thinking','speaking','listening','dormant'])assert.equal(voiceSignal(phase,true,1),'jarvis')
 assert.equal(voiceSignal('speaking',false,1),'jarvis')
 assert.equal(VOICE_COLORS.jarvis,'#ff453a')
})
test('fora da resposta a cor distingue a fala do usuário e o repouso',()=>{
 assert.equal(voiceSignal('listening',false,1),'user')
 assert.equal(voiceSignal('dormant',false,0),'idle')
})
