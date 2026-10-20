import {test} from 'node:test'
import assert from 'node:assert/strict'
import {groupTelegramUpdates,collectTelegramUpdates} from '../bridge/telegram-fragments.mjs'
const update=(id,text,date=100,user=7)=>({update_id:id,message:{message_id:id*2,date,text,chat:{id:user,type:'private'},from:{id:user,is_bot:false}}})

test('a long text and its immediate continuation become one intact request with the last offset',()=>{
  const first=update(100,'a'.repeat(3800)),second=update(101,'Final do mesmo capítulo.')
  const result=groupTelegramUpdates([first,second])
  assert.equal(result.length,1)
  assert.equal(result[0].update_id,101)
  assert.equal(result[0].message.text,first.message.text+'\n'+second.message.text)
  assert.deepEqual(result[0].message.fragmentMessageIds,[200,202])
  assert.equal(first.message.text.length,3800)
})

test('lookahead keeps the original update unacknowledged and removes repeated deliveries before grouping',async()=>{
  const first=update(100,'a'.repeat(3800)),second=update(101,'Continuação.')
  let waits=0,reads=0
  const grouped=await collectTelegramUpdates([first],{owner:()=>true,wait:async()=>{waits++},fetchMore:async()=>{reads++;return[first,second]}})
  assert.equal(waits,1);assert.equal(reads,1);assert.equal(grouped.length,1)
  assert.equal(grouped[0].message.text.length,3813)
})

test('separate owners, commands, forwarded text, short messages and distant dates stay separate',()=>{
  for(const [first,next] of [
    [update(1,'a'.repeat(3800)),update(2,'Outro dono',100,8)],
    [update(1,'a'.repeat(3800)),update(2,'/cancelar')],
    [update(1,'a'.repeat(3800)),update(2,'Outro pedido',105)],
    [update(1,'Pedido curto'),update(2,'Outro pedido')],
    [update(1,'a'.repeat(3800)),{...update(2,'Encaminhado'),message:{...update(2,'Encaminhado').message,forward_origin:{}}}],
  ])assert.equal(groupTelegramUpdates([first,next]).length,2)
})

test('parts retain their order beyond the old context limit without becoming separate jobs',()=>{
  const parts=[update(1,'a'.repeat(3800)),update(2,'b'.repeat(3800)),update(3,'Fim')]
  const grouped=groupTelegramUpdates(parts)
  assert.equal(grouped.length,1);assert.equal(grouped[0].message.text,'a'.repeat(3800)+'\n'+'b'.repeat(3800)+'\nFim')
  const long=groupTelegramUpdates(Array.from({length:6},(_,i)=>update(i+1,String(i).repeat(3800))))
  assert.equal(long.length,1);assert.equal(long[0].message.text.length,22805)
})
