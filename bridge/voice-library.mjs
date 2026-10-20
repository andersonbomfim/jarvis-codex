import {readFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {speechText} from '../shared/speech-text.mjs'
import {audioMime} from './openspeaker-speech.mjs'
const root=join(import.meta.dirname,'..'),folder=join(root,'assets','voice-pack')
export const voicePresets=JSON.parse(readFileSync(join(root,'shared','voice-presets.json'),'utf8'))
const normalize=text=>speechText(text).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()
export const voicePresetForText=text=>voicePresets.find(p=>normalize(p.text)===normalize(text))??null
export async function readVoicePreset(id){
  if(!voicePresets.some(p=>p.id===id))return null
  const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8')),clip=manifest.clips.find(p=>p.id===id)
  if(!clip||clip.file!==id+'.mp3')throw Error('Manifesto de voz inconsistente.')
  const bytes=await readFile(join(folder,clip.file))
  if(createHash('sha256').update(bytes).digest('hex')!==clip.sha256)throw Error('A gravação foi alterada ou está corrompida. Reinstale o pacote; nenhuma geração foi feita.')
  audioMime(bytes);return bytes
}
export async function prepareVoiceLibrary(){throw Error('As 41 gravações já acompanham o programa; não gerar novamente.')}
export async function voiceLibraryRoute(req,res,cors){
  const url=new URL(req.url,'http://localhost')
  if(!url.pathname.startsWith('/speech-presets'))return false
  if(req.method!=='GET'){res.writeHead(405,cors);res.end();return true}
  if(url.pathname==='/speech-presets'){
    const presets=await Promise.all(voicePresets.map(async p=>{let ready=false;try{ready=Boolean(await readVoicePreset(p.id))}catch{}return {...p,ready}}))
    res.writeHead(200,{...cors,'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({configured:presets.every(p=>p.ready),presets}));return true
  }
  try{
    const bytes=await readVoicePreset(url.pathname.slice('/speech-presets/'.length))
    if(!bytes){res.writeHead(404,cors);res.end();return true}
    res.writeHead(200,{...cors,'content-type':audioMime(bytes),'cache-control':'no-store'});res.end(bytes)
  }catch{res.writeHead(503,cors);res.end('Gravação indisponível. Nenhuma síntese foi realizada.')}
  return true
}
