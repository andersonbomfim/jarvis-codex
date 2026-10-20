import {createServer} from 'node:http'
import {readFile,stat,realpath} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,extname} from 'node:path'
const folder=resolve(import.meta.dirname,'../dist'),port=Number(process.env.PORT||5173)
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm'}
const inside=path=>{const rel=relative(folder,path);return !rel.startsWith('..')&&!isAbsolute(rel)}
const server=createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
  let path=resolve(folder,'.'+pathname);if(!inside(path))throw Error('Invalid path')
  try{if((await stat(path)).isDirectory())path=join(path,'index.html')}catch(e){if(e.code==='ENOENT'&&!extname(path))path=join(folder,'index.html');else throw e}
  path=await realpath(path);if(!inside(path))throw Error('Invalid symlink')
  const bytes=await readFile(path);res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','content-length':bytes.length,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes)
 }catch{res.writeHead(404);res.end('Não encontrado')}
})
server.listen(port,'127.0.0.1',()=>console.log('Interface local: http://127.0.0.1:'+port))
