import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTelegramReply, sendTelegramReply, sendAutomaticTelegramReply } from '../bridge/telegram-format.mjs'

test('screenshot reply becomes actual bold and a named clickable link', () => {
  const [part] = formatTelegramReply('Senhor, é uma **versão de Xbox**. Consulte [código dessa adaptação](https://github.com/TGP482/BLACK-XBERecomp/blob/main/src/game/prompts.cpp).\n\n**A troca dos símbolos não ficou corrigida:** exige uma modificação.')
  assert.ok(!part.text.includes('**'))
  const highlights = part.entities.filter(e => e.type === 'bold').map(e => part.text.slice(e.offset, e.offset + e.length))
  assert.deepEqual(highlights, ['versão de Xbox', 'A troca dos símbolos não ficou corrigida:'])
  const link = part.entities.find(e => e.type === 'text_link')
  assert.equal(part.text.slice(link.offset, link.offset + link.length), 'código dessa adaptação')
  assert.match(link.url, /prompts\.cpp$/)
})

test('Unicode offsets, HTML characters, paths and plain punctuation are preserved', () => {
  const [part] = formatTelegramReply('🤖 **A&B <senhor>** C:\\Users\\Usuário — 2 * 3 = 6!')
  assert.equal(part.text, '🤖 A&B <senhor> C:\\Users\\Usuário — 2 * 3 = 6!')
  assert.deepEqual(part.entities, [{ type: 'bold', offset: 3, length: 'A&B <senhor>'.length }])
})

test('long highlights and links retain correct offsets across message boundaries', () => {
  const label = '🤖x'.repeat(2600)
  const parts = formatTelegramReply('**[Texto ' + label + '](https://example.com/a_(b))**\nFim')
  assert.equal(parts.map(p => p.text).join(''), 'Texto ' + label + '\nFim')
  assert.ok(parts.length > 2)
  for (const part of parts) {
    assert.ok(part.text.length <= 3500)
    assert.ok(!/[\uD800-\uDBFF]$/.test(part.text))
    for (const e of part.entities) {
      assert.ok(e.offset >= 0 && e.length > 0 && e.offset + e.length <= part.text.length)
      if (e.type === 'text_link') assert.equal(e.url, 'https://example.com/a_(b)')
    }
  }
  assert.deepEqual(formatTelegramReply('a'.repeat(3499) + '🤖**Z**').at(-1), { text: '🤖Z', entities: [{ type: 'bold', offset: 2, length: 1 }] })
})

test('code is literal, malformed markup stays readable and unsafe links are not activated', () => {
  const [code] = formatTelegramReply('`**literal**`\n```js\nconst a = "**x**"\n```')
  assert.equal(code.text, '**literal**\nconst a = "**x**"\n')
  assert.deepEqual(code.entities.map(e => e.type), ['code', 'pre'])
  for (const value of ['**incompleto', '[x](javascript:alert(1))', '[x](https://)', '<b>literal</b>']) {
    assert.deepEqual(formatTelegramReply(value), [{ text: value, entities: [] }])
  }
  assert.deepEqual(formatTelegramReply('\\*\\*literal\\*\\*'), [{ text: '**literal**', entities: [] }])
})

test('the actual send helper submits entities and preserves sequential delivery', async () => {
  const calls = []
  await sendTelegramReply(async (method, payload) => calls.push({ method, payload }), 'owner', '**Olá, senhor.**')
  assert.deepEqual(calls, [{ method: 'sendMessage', payload: { chat_id: 'owner', text: 'Olá, senhor.', entities: [{ type: 'bold', offset: 0, length: 12 }], link_preview_options: { is_disabled: true } } }])
  assert.deepEqual(formatTelegramReply('   '), [])
})

test('only an automatic reply waits two seconds; work receipts and final results do not wait', async () => {
  const events = []
  const call = async (method, payload) => events.push([method, payload.text || payload.action])
  const wait = async ms => { events.push(['wait', ms]); await Promise.resolve() }
  await sendAutomaticTelegramReply(call, 'owner', 'De nada, senhor.', { wait })
  assert.equal(events.filter(e => e[0] === 'wait').length, 1)
  assert.ok(events.some(e => e[0] === 'wait' && e[1] === 2000))
  assert.ok(events.some(e => e[0] === 'sendChatAction' && e[1] === 'typing'))
  assert.deepEqual(events.at(-1), ['sendMessage', 'De nada, senhor.'])
  events.length = 0
  await sendTelegramReply(call, 'owner', 'Recebido, senhor.')
  await sendTelegramReply(call, 'owner', 'O trabalho está concluído.')
  assert.deepEqual(events, [['sendMessage', 'Recebido, senhor.'], ['sendMessage', 'O trabalho está concluído.']])
})
