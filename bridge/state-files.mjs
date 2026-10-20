import {open,stat,unlink,mkdir,writeFile,rename} from 'node:fs/promises'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
export async function atomicJson(path,value){
  await mkdir(dirname(path),{recursive:true})
  const tmp=path+'.'+randomUUID()+'.tmp'
  await writeFile(tmp,JSON.stringify(value,null,2));await rename(tmp,path)
}
export async function fileLock(path,work){
  await mkdir(dirname(path),{recursive:true})
  let handle
  for(let attempt=0;attempt<40;attempt++){
    try{handle=await open(path,'wx');break}catch(error){
      if(error.code!=='EEXIST')throw error
      try{if(Date.now()-(await stat(path)).mtimeMs>60000)await unlink(path)}catch(e){if(e.code!=='ENOENT')throw e}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
  }
  if(!handle)throw Error('Estado ocupado; tente novamente.')
  try{return await work()}finally{await handle.close();await unlink(path).catch(()=>{})}
}
