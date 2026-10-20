import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { speechText } from '../shared/speech-text.mjs'
import { createOpenSpeakerClient } from '../bridge/openspeaker-speech.mjs'

test('spoken version preserves findings and warnings without Markdown or source lists', () => {
  const written = 'Senhor, **há um caminho técnico plausível.** Ainda não é uma solução testada.\n\n**O que encontrei**\n- Falta o compilador **Clang**.\n- O disco E tem **89,5 GB livres**.\n\nFontes: [requisitos oficiais](https://github.com/TGP482/BLACK-XBERecomp#building), [código](https://github.com/TGP482/BLACK-XBERecomp/blob/main/src/game/prompts.cpp).\n\n**Agora aguardo sua aprovação; nenhuma instalação foi iniciada.**'
  const narration = speechText(written)
  assert.equal(narration, 'Senhor, há um caminho técnico plausível. Ainda não é uma solução testada. O que encontrei Falta o compilador Clang. O disco E tem 89,5 GB livres. Agora aguardo sua aprovação; nenhuma instalação foi iniciada.')
  assert.ok(written.includes('https://github.com/'))
  assert.equal(speechText(narration), narration)
})

test('links become meaningful labels; raw and nested URLs never reach narration', () => {
  assert.equal(speechText('Confira [o resultado](https://example.org/a_(b)?x=1&y=2).'), 'Confira o resultado.')
  assert.equal(speechText('O resultado está em https://example.org/um/caminho/muito-longo. Eu preservei o original.'), 'O resultado está no texto. Eu preservei o original.')
  for (const value of ['www.example.org/a', '<https://example.org/a>', '<a href="https://example.org/a">a proposta</a>']) {
    assert.ok(!/https?:|www\.|href|[<>]/.test(speechText(value)))
  }
})

test('multiline references, code and citation syntax are not recited; decisions survive', () => {
  const result = speechText('**Referências:**\n- [Uma fonte](https://example.org/1)\n- https://example.org/2\n\nEu preciso da sua aprovação.\n```ps\nGet-Process\n```\nO risco continua. citeturn1search0')
  assert.equal(result, 'Eu preciso da sua aprovação. Os detalhes técnicos estão no texto. O risco continua.')
})

test('provider boundary receives only narration and reuses one task for equivalent text', async () => {
  const root = join(import.meta.dirname, '..', '.local', 'tests')
  await mkdir(root, { recursive: true })
  const cacheDir = await mkdtemp(join(root, 'speech-format-'))
  let submissions = 0
  const wave = Buffer.alloc(48); wave.write('RIFF'); wave.write('WAVE', 8)
  const client = createOpenSpeakerClient({ apiKey: 'fake-key', voiceId: 'clone_test', cacheDir, fetchImpl: async (url, options) => {
    if (url.endsWith('/v3/text-to-speech')) {
      submissions++
      assert.equal(options.body.get('text'), 'Senhor, consulte a proposta. Ainda preciso da sua aprovação.')
      return Response.json({ success: true, task_id: 'fake-task' })
    }
    if (url.includes('/v1/task/')) return Response.json({ status: 'done', metadata: { audio_url: 'https://example.invalid/fake.wav' } })
    return new Response(wave)
  } })
  const written = 'Senhor, consulte **[a proposta](https://example.org/proposta)**. Ainda preciso da sua aprovação.'
  await client.generate(written)
  assert.equal((await client.generate(speechText(written))).cached, true)
  assert.equal(submissions, 1)
})
