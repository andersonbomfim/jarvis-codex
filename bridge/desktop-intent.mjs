import {interpretTelegramRequest as interpretAssistantRequest} from './telegram-intent.mjs'

export function createDesktopIntentRoute({interpret=interpretAssistantRequest}={}) {
 return async function route(req,res,cors) {
  if(req.url!=='/assistant/interpret'||req.method!=='POST')return false
  const send=(status,value)=>{res.writeHead(status,{...cors,'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));return true}
  const control={}
  const cancel=()=>control.cancel?.()
  const closed=()=>{if(!res.writableEnded)cancel()}
  req.on('aborted',cancel);res.on('close',closed)
  try {
   const chunks=[];let size=0
   for await(const chunk of req){size+=chunk.length;if(size>128*1024)return send(413,{error:'Pedido muito extenso para interpretar.'});chunks.push(chunk)}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(400,{error:'Pedido inválido.'})}
   if(typeof input.text!=='string'||!input.text.trim())return send(400,{error:'O pedido está vazio.'})
   const context=Array.isArray(input.context)?input.context.filter(item=>item&&['user','jarvis','assistant'].includes(item.role)&&typeof item.text==='string').slice(-6):[]
   const intent=await interpret(input.text,{eligible:input.eligible!==false,context,control})
   return send(200,intent)
  }catch(error){return send(503,{error:error.message||'Não consegui interpretar o pedido agora.'})}
  finally{req.off('aborted',cancel);res.off('close',closed)}
 }
}
export const desktopIntentRoute=createDesktopIntentRoute()
