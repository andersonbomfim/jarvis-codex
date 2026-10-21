import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,readdir,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initialize} from '../scripts/initialize.mjs'
import {updateProfile,ProfileUpdate} from '../bridge/user-profile.mjs'
import {voicePresets,readVoicePreset,prepareVoiceLibrary} from '../bridge/voice-library.mjs'
import {auditPublic} from '../scripts/audit-public.mjs'
import {createMorningBriefingRoute,morningDate} from '../bridge/morning-briefing.mjs'
test('all 41 real bundled recordings pass integrity without an account or synthesis',async()=>{
 assert.equal(voicePresets.length,41)
 for(const preset of voicePresets){const audio=await readVoicePreset(preset.id);assert.ok(audio.length>100);assert.deepEqual(await readVoicePreset(preset.id,{telegram:true}),audio)}
 await assert.rejects(prepareVoiceLibrary(),/não gerar/)
})
test('first setup belongs to the person, contains no creator profile and preserves existing data on rerun',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-community-'))
 await initialize({root,profile:{displayName:'Pessoa de teste',city:'Recife, PE',timezone:'America/Recife',interests:['fotografia']}})
 const profile=JSON.parse(await readFile(join(root,'.local/profile.json'),'utf8'))
 assert.equal(profile.city,'Recife, PE');assert.equal(profile.displayName,'Pessoa de teste');assert.equal(profile.allowWrites,false)
 const marker=join(root,'.local/projects/state.json');await writeFile(marker,'{"projects":[{"id":"existing"}]}')
 await initialize({root,profile:{city:'Curitiba, PR'}})
 assert.equal(JSON.parse(await readFile(marker,'utf8')).projects[0].id,'existing')
 const next=JSON.parse(await readFile(join(root,'.local/profile.json'),'utf8'));assert.equal(next.displayName,'Pessoa de teste');assert.equal(next.city,'Curitiba, PR')
 const speech=JSON.parse(await readFile(join(root,'.local/openspeaker.json'),'utf8'));assert.equal(speech.enabled,false);assert.equal(speech.fixedVoiceEnabled,true);assert.equal(speech.voiceId,null)
 const briefing=JSON.parse(await readFile(join(root,'.local/briefing-settings.json'),'utf8'));assert.equal(briefing.automaticPlayback,false);assert.equal(briefing.telegramDelivery.enabled,false);assert.equal(briefing.generationEnabled,false)
})
test('confirmed personal preferences are updated without copying anyone else or changing unrelated fields',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-profile-')),path=join(root,'profile.json')
 const old={displayName:'Pessoa de teste',city:'Recife',timezone:'America/Recife',preferences:['respostas desenvolvidas'],allowWrites:false}
 const next=await updateProfile({city:'Natal'},path,old)
 assert.equal(next.displayName,old.displayName);assert.deepEqual(next.preferences,old.preferences);assert.equal(next.city,'Natal');assert.equal(next.allowWrites,false)
 assert.equal(ProfileUpdate.safeParse({timezone:'fuso-inexistente'}).success,false)
 assert.equal(ProfileUpdate.safeParse({allowWrites:true}).success,false)
})
test('only public source and the approved voice pack are present',async()=>{
 const result=await auditPublic();assert.deepEqual(result.issues,[])
 const files=await readdir(new URL('../assets/voice-pack/',import.meta.url));assert.equal(files.filter(p=>p.endsWith('.mp3')).length,41)
})
test('the personal timezone is respected and morning playback always requires a request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-routine-'))
 let now=new Date('2026-10-20T10:59:59Z')
 const date=morningDate(now,'America/Recife');await mkdir(join(root,date));await writeFile(join(root,date,'briefing.txt'),'Bom dia.')
 const route=createMorningBriefingRoute({directoryRoot:root,now:()=>now,timezone:'America/Recife'})
 async function status(){let payload;await route({method:'GET',url:'/morning-briefing'},{writeHead(){},end(body){payload=JSON.parse(body)}},{});return payload}
 assert.equal((await status()).due,false)
 now=new Date('2026-10-20T11:00:00Z');assert.equal((await status()).due,false);assert.equal((await status()).playbackMode,'on_request')
 now=new Date('2026-10-20T11:30:00Z');assert.equal((await status()).due,false)
 assert.equal(morningDate(new Date('2026-10-20T01:00:00Z'),'America/Recife'),'2026-10-19')
 assert.equal(morningDate(new Date('2026-10-20T01:00:00Z'),'Asia/Tokyo'),'2026-10-20')
})
