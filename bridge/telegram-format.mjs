// Telegram entities use UTF-16 offsets, matching JavaScript string indices.
// Send explicit entities instead of enabling a Markdown dialect for arbitrary output.
export function formatTelegramReply(value, limit = 3500) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 4096) throw Error('Limite de mensagem inválido.')
  let text = ''
  const entities = []
  function render(source, insideBold = false, insideLink = false) {
    for (let i = 0; i < source.length;) {
      const rest = source.slice(i)
      let match
      if (rest[0] === '\\' && /^\\[\\*`\[\]]/.test(rest)) {
        text += rest[1]; i += 2; continue
      }
      // Code remains literal; its contents must never become formatting or links.
      if (!insideBold && !insideLink && (match = /^```(?:[\w+-]+)?\r?\n([\s\S]*?)```/.exec(rest))) {
        const offset = text.length; text += match[1]
        if (text.length > offset) entities.push({ type: 'pre', offset, length: text.length - offset })
      } else if (!insideBold && !insideLink && (match = /^`([^`\n]+)`/.exec(rest))) {
        const offset = text.length; text += match[1]
        entities.push({ type: 'code', offset, length: text.length - offset })
      } else if (!insideLink && (match = /^\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^()\s]*\))+)\)/.exec(rest))) {
        let valid = false
        try { const url = new URL(match[2]); valid = !!url.hostname && !url.username && !url.password } catch {}
        if (!valid) { text += source[i++]; continue }
        const offset = text.length
        render(match[1], insideBold, true)
        entities.push({ type: 'text_link', offset, length: text.length - offset, url: match[2] })
      } else if (!insideBold && (match = /^\*\*(\S(?:[\s\S]*?\S)?)\*\*(?!\*)/.exec(rest))) {
        const offset = text.length
        render(match[1], true, insideLink)
        entities.push({ type: 'bold', offset, length: text.length - offset })
      } else {
        text += source[i++]; continue
      }
      i += match[0].length
    }
  }
  render(String(value).trim())
  const parts = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1)
      if (newline >= start + limit / 2) end = newline + 1
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--
    }
    const chunkEntities = entities.flatMap(entity => {
      const from = Math.max(start, entity.offset)
      const to = Math.min(end, entity.offset + entity.length)
      return to > from ? [{ ...entity, offset: from - start, length: to - from }] : []
    }).sort((a, b) => a.offset - b.offset || b.length - a.length)
    parts.push({ text: text.slice(start, end), entities: chunkEntities })
    start = end
  }
  return parts
}

export async function sendTelegramReply(call, chatId, text) {
  for (const part of formatTelegramReply(text)) {
    await call('sendMessage', {
      chat_id: chatId,
      ...part,
      link_preview_options: { is_disabled: true },
    })
  }
}

/** A natural pause applies only to canned social replies, never work receipts/results. */
export async function sendAutomaticTelegramReply(call, chatId, text, {
  delayMs = 2000,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const delay = Number.isFinite(Number(delayMs)) ? Math.min(10000, Math.max(0, Number(delayMs))) : 2000
  if (delay > 0) {
    void Promise.resolve().then(() => call('sendChatAction', { chat_id: chatId, action: 'typing' })).catch(() => {})
    await wait(delay)
  }
  return sendTelegramReply(call, chatId, text)
}
