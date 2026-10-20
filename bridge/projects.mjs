import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
import {createSdkMcpServer,tool} from './local-tools.mjs'
import {atomicJson,fileLock} from './state-files.mjs'
export const PROJECT_FILE=join(import.meta.dirname,'..','.local','projects','state.json')
const item=z.object({text:z.string().min(1).max(2000),source:z.string().min(1).max(1500),confirmed:z.boolean()})
const update=z.object({id:z.string().regex(/^[a-z0-9-]{1,80}$/),name:z.string().min(1).max(160),status:z.enum(['active','paused','complete','unknown']),summary:z.string().max(3000),source:z.string().min(1).max(1500),lastDecision:item.nullable(),pending:z.array(item).max(30),nextAction:item.nullable()})
export async function readProjects(path=PROJECT_FILE){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return {schemaVersion:1,projects:[]};throw error}}
export async function updateProject(input,path=PROJECT_FILE){
 const value=update.parse(input)
 return fileLock(path+'.lock',async()=>{
  const data=await readProjects(path),previous=data.projects.find(p=>p.id===value.id)
  const record={...value,updatedAt:new Date().toISOString()}
  data.projects=data.projects.filter(p=>p.id!==value.id);data.projects.push(record)
  data.history=[...(data.history||[]),{at:record.updatedAt,projectId:value.id,previous:previous||null}].slice(-100)
  await atomicJson(path,data);return record
 })
}
export function projectsServer({path=PROJECT_FILE,onUpdate=async()=>{}}={}){
 return createSdkMcpServer({name:'projects',tools:[
  tool('list_projects','Consulta a memória persistente de andamento: decisões aprovadas, pendências, próxima ação e respectivas fontes/datas. Dados antigos ou não confirmados não provam o estado atual.',{},async()=>({content:[{type:'text',text:JSON.stringify((await readProjects(path)).projects)}]})),
  tool('get_project','Consulta o estado registrado de um projeto pelo identificador.',{id:z.string()},async({id})=>({content:[{type:'text',text:JSON.stringify((await readProjects(path)).projects.find(p=>p.id===id)||null)}]})),
  tool('update_project','Registra estado e progresso de projeto autorizado por Usuário. Forneça fontes reais. Registre decisões como confirmadas somente com aprovação explícita ou fato efetivamente verificado. Não invente pendências/prazos, não guarde credenciais e não substitua a personalidade geral por inferências.',update.shape,async input=>{const project=await updateProject(input,path);await onUpdate().catch(()=>{});return {content:[{type:'text',text:JSON.stringify(project)}]}})
 ]})
}
