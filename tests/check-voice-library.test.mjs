import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voicePresets } from '../bridge/voice-library.mjs'
import { speechReply } from '../bridge/speech-reply.mjs'

test('all fixed phrases reuse recordings, including formatted replies and Telegram receipts', async () => {
  let generated = 0
  const bytes = Buffer.from('cached recording')
  for (const preset of voicePresets) {
    const result = await speechReply('**' + preset.text + '**', {
      telegram: true,
      readPreset: async (id, options) => { assert.equal(id, preset.id); assert.equal(options.telegram, true); return bytes },
      generate: async () => { generated++; throw Error('Paid synthesis must not run') },
    })
    assert.equal(result, bytes)
  }
  assert.equal(generated, 0)
})

test('missing recordings fail without submitting another paid task', async () => {
  let generated = 0
  await assert.rejects(speechReply('Um momento, senhor.', {
    readPreset: async () => null,
    generate: async () => { generated++ },
  }), /Não foi feita uma nova geração/)
  assert.equal(generated, 0)
})

test('a substantive answer cannot enable synthesis even with a caller override', async () => {
  const answer = 'Pronto, senhor. O arquivo foi salvo e eu conferi as três páginas.'
  let calls = 0
  const result=await speechReply(answer, {
    allowGeneration: true,
    readPreset: async () => { throw Error('Not a preset') },
    generate: async text => { calls++; assert.equal(text, answer); return Buffer.from('dynamic') },
  })
  assert.equal(result, null)
  assert.equal(calls, 0)
})

test('normal replies are text-only and cannot submit a synthesis task under the current policy', async () => {
  let generated = 0
  const result = await speechReply('Senhor, encontrei três documentos relevantes.', {
    generate: async () => { generated++; throw Error('No interactive synthesis') },
  })
  assert.equal(result, null)
  assert.equal(generated, 0)
})
