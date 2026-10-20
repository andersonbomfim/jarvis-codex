import {createInterface} from 'node:readline/promises'
import {stdin,stdout} from 'node:process'
import {initialize} from './initialize.mjs'
import {userProfile} from '../bridge/user-profile.mjs'
const rl=createInterface({input:stdin,output:stdout}),old=userProfile()
try{
 const displayName=(await rl.question('Como devo chamar você? ['+old.displayName+'] ')).trim()||old.displayName
 const city=(await rl.question('Cidade para previsão do tempo: ['+old.city+'] ')).trim()||old.city
 const timezone=(await rl.question('Fuso IANA: ['+old.timezone+'] ')).trim()||old.timezone
 const workContext=(await rl.question('Seu trabalho e principais projetos (opcional): ')).trim()||old.workContext
 const interests=(await rl.question('Interesses separados por vírgula (opcional): ')).split(',').map(s=>s.trim()).filter(Boolean)
 await initialize({profile:{displayName,city,timezone,workContext,interests:interests.length?interests:old.interests}})
 console.log('Perfil salvo somente neste computador. As gravações prontas continuam as mesmas.')
}finally{rl.close()}
