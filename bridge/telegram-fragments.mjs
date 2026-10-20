/** Join rapid continuations of a long message, without merging unrelated requests. */
export function isLongTelegramText(message) {
  return typeof message?.text==='string' && message.text.length>=3500 && !message.text.trimStart().startsWith('/') &&
    !message.forward_origin && !message.document && !message.voice && !message.audio && !message.photo
}

export function groupTelegramUpdates(updates,{maxGapSeconds=2}={}) {
  const unique=[...new Map(updates.map(update=>[update.update_id,update])).values()].sort((a,b)=>a.update_id-b.update_id)
  const groups=[]
  for(const update of unique) {
    const message=update.message,previous=groups.at(-1)
    const tail=previous?.tail
    const plain=typeof message?.text==='string'&&!message.forward_origin&&!message.document&&!message.voice&&!message.audio&&!message.photo&&!message.text.trimStart().startsWith('/')
    const gap=Number(message?.date)-Number(tail?.date)
    const merge=plain&&isLongTelegramText(tail)&&message.chat?.type==='private'&&tail.chat?.type==='private'&&
      message.from?.is_bot===false&&tail.from?.is_bot===false&&String(message.from?.id)===String(tail.from?.id)&&
      String(message.chat?.id)===String(tail.chat?.id)&&Number.isFinite(gap)&&gap>=0&&gap<=maxGapSeconds
    if(merge) {
      previous.update.update_id=update.update_id
      previous.update.message.text+='\n'+message.text
      previous.update.message.fragmentMessageIds.push(message.message_id)
      previous.tail=message
    } else {
      groups.push({tail:message,update:{...update,message:message?{...message,fragmentMessageIds:[message.message_id]}:message}})
    }
  }
  return groups.map(group=>group.update)
}

/** Re-poll the same unacknowledged offset after a brief collection window. */
export async function collectTelegramUpdates(updates,{owner,fetchMore,wait,delayMs=900}={}) {
  let collected=updates
  for(let round=0;round<3;round++) {
    const last=collected.at(-1)
    if(!last||!owner(last.message)||!isLongTelegramText(last.message))break
    await wait(delayMs)
    const extra=await fetchMore()
    const combined=[...new Map([...collected,...extra].map(update=>[update.update_id,update])).values()].sort((a,b)=>a.update_id-b.update_id)
    if(combined.length===collected.length)break
    collected=combined
  }
  return groupTelegramUpdates(collected)
}
