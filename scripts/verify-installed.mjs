import {access,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {voicePresets,readVoicePreset} from '../bridge/voice-library.mjs'
import {userProfile} from '../bridge/user-profile.mjs'
const root=resolve(import.meta.dirname,'..'),profile=userProfile()
if(!profile.displayName||!profile.timezone)throw Error('O perfil pessoal não foi salvo.')
for(const preset of voicePresets)if(!(await readVoicePreset(preset.id))?.length)throw Error('Gravação ausente: '+preset.id)
for(const name of ['Jarvis.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])await access(resolve(root,'.local/desktop/app',name))
const paths=JSON.parse((await readFile(resolve(root,'.local/runtime-paths.json'),'utf8')).replace(/^\uFEFF/,''))
await access(paths.node);await access(paths.codex)
console.log(JSON.stringify({instalacao:'verificada',gravacoes:voicePresets.length,perfilPessoal:'configurado',geracoesDeVoz:0,chamadasAoModelo:0,loginPessoal:'ainda necessário'}))
