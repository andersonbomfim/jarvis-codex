import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { quickReplyFor, quickReplyForMessage } from '../shared/quick-replies.mjs'
import { receiptFor } from '../bridge/telegram.mjs'

test('simple conversation returns the agreed response directly, without an asynchronous classifier', () => {
  for (const [input, expected] of [
    ['Obrigado', 'De nada, senhor.'], ['Muito obrigada, Jarvis!', 'De nada, senhor.'],
    ['Valeu mesmo!', 'De nada, senhor.'], ['De nada.', 'Obrigado, senhor.'],
    ['Bom dia, Jarvis.', 'Bom dia, senhor.'], ['Jarvis, boa tarde!', 'Boa tarde, senhor.'],
    ['Boa noite', 'Boa noite, senhor.'], ['Olá, Jarvis', 'À sua disposição, senhor.'],
    ['Jarvis?', 'À sua disposição, senhor.'], ['Você está acordado?', 'Para o senhor, sempre.'],
    ['Jarvis acordado.', 'Para o senhor, sempre.'], ['Jarvis, acordou?', 'Para o senhor, sempre.'],
    ['Acordado?', 'Para o senhor, sempre.'], ['Jarvis, me ouve?', 'Para o senhor, sempre.'],
  ]) {
    const reply = quickReplyFor(input)
    assert.equal(reply?.text, expected, input)
    assert.equal(typeof reply?.then, 'undefined')
  }
})

test('complete requests, contextual approvals and substantive follow-ups are never swallowed', () => {
  for (const input of [
    'Bom dia, pesquise as notícias.', 'Obrigado. Agora abra o jogo.', 'Boa noite, qual a previsão de amanhã?',
    'Bom dia, tem alguma novidade?', 'Obrigado pelo relatório, mas corrija o título.',
    'Sim', 'Pode fazer', 'Pronto', 'Certo', 'Está bem', 'De nada, agora vamos continuar.',
    'Você está aí? Pesquise isso.', '/obrigado', '', null,
    'Jarvis acordado. Pesquise o tempo de amanhã.', 'Acorda e abra minha agenda.',
    'Eu acho que não vale a pena. De qualquer forma obrigado, mas pesquise outra solução.',
    'Não precisa, obrigado. Pode continuar o outro trabalho.',
    'De qualquer forma obrigado. Quanto isso custa?',
    'Eu acho que não vale a pena porque o outro método é melhor. Obrigado.',
  ]) assert.equal(quickReplyFor(input), null, String(input))
})

test('the reported conversational closing gets a single direct reply without a work receipt', () => {
  for (const text of [
    'Eu acho que não vale a pena.\nDe qualquer forma obrigado',
    'Não vale a pena. Mesmo assim, obrigado.',
    'De qualquer forma, obrigado, Jarvis.',
    'Era só isso, muito obrigado.',
    'Não precisa, obrigado.',
    'Jarvis, deixa pra lá. Valeu!',
  ]) {
    const message = { text }
    assert.equal(quickReplyForMessage(message)?.text, 'De nada, senhor.', text)
    assert.equal(receiptFor(message), null, text)
  }
})

test('forwarded messages and attachments cannot be mistaken for a casual greeting', () => {
  for (const extra of [{ document: {} }, { voice: {} }, { audio: {} }, { photo: [] }, { forward_origin: {} }]) {
    assert.equal(quickReplyForMessage({ text: 'Bom dia', ...extra }), null)
  }
  assert.equal(quickReplyForMessage({ text: 'Bom dia' }).text, 'Bom dia, senhor.')
})

test('all immediate responses have a unique preset ready for the one-time voice preparation', async () => {
  const presets = JSON.parse(await readFile(new URL('../shared/voice-presets.json', import.meta.url), 'utf8'))
  assert.equal(new Set(presets.map(p => p.id)).size, presets.length)
  for (const text of ['bom dia', 'boa tarde', 'boa noite', 'obrigado', 'de nada', 'oi', 'você está aí']) {
    const reply = quickReplyFor(text)
    assert.ok(presets.some(p => p.id === reply.id && p.text === reply.text))
  }
})
