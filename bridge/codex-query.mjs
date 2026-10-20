// Preserve the original voice/WebSocket protocol while using the signed-in Codex.
import { codexClient } from './codex-client.mjs'

export function query({ prompt, options }) {
  const client = codexClient()
  const events = []
  let wake, ended = false, threadId, activeTurn, finish, cancelled = false, turnCompletion
  const emit = value => { events.push(value); wake?.(); wake = null }
  const definitions = [], handlers = new Map(), servers = {}
  for (const [key, server] of Object.entries(options.mcpServers ?? {})) {
    if (server.type === 'local') {
      for (const t of server.tools) {
        const name = `${key}__${t.name}`
        definitions.push({ type: 'function', name, description: t.description, inputSchema: t.inputSchema, deferLoading: false })
        handlers.set(name, { ...t, canonical: `mcp__${key}__${t.name}` })
      }
    } else {
      servers[key] = {
        command: server.command, args: server.args ?? [],
        ...(server.env ? { env: server.env } : {}),
        startup_timeout_sec: 60,
      }
    }
  }
  const toolEvent = (id, name) => emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name } } })
  const listener = msg => {
    const p = msg.params ?? {}
    if (msg.method === 'jarvis/disconnected') { emit({ type: 'result', is_error: true, errors: [p.message] }); ended = true; wake?.(); finish?.(); return }
    if (p.threadId !== threadId) return
    if (msg.method === 'item/agentMessage/delta') {
      emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: p.delta } } })
    } else if (msg.method === 'item/started') {
      const item = p.item ?? {}
      if (item.type === 'commandExecution') toolEvent(item.id, 'Bash')
      if (item.type === 'fileChange') toolEvent(item.id, 'Edit')
      if (item.type === 'webSearch') toolEvent(item.id, 'WebSearch')
      if (item.type === 'mcpToolCall') toolEvent(item.id, `mcp__${item.server}__${item.tool}`)
      if (item.type === 'dynamicToolCall') toolEvent(item.id, handlers.get(item.tool)?.canonical ?? item.tool)
    } else if (msg.method === 'turn/started') {
      activeTurn = p.turn?.id
    } else if (msg.method === 'turn/completed') {
      const bad = p.turn?.status !== 'completed'
      emit({ type: 'result', subtype: bad ? 'error_during_execution' : 'success', is_error: bad, errors: bad ? [p.turn?.error?.message ?? (p.turn?.status === 'interrupted' ? 'Execução interrompida.' : `Falha no Codex (${p.turn?.status ?? 'sem estado'}).`)] : [] })
      activeTurn = null; finish?.(); finish = null
    }
  }
  client.listeners.add(listener)
  const run = async () => {
    try {
      await client.ready
      const started = await client.request('thread/start', {
        cwd: options.cwd, approvalPolicy: 'never', sandbox: options.sandbox ?? 'danger-full-access',
        baseInstructions: options.systemPrompt,
        ...(options.model ? { model: options.model } : {}),
        dynamicTools: definitions, ephemeral: true,
        config: { mcp_servers: servers, web_search: options.webSearch ?? 'live', model_reasoning_effort: options.effort ?? 'medium', multi_agent_mode: 'explicitRequestOnly' },
      })
      threadId = started.thread.id
      console.log(`[jarvis] Codex conectado · ${started.model ?? 'modelo da conta'}`)
      client.handlers.set(threadId, async (method, params) => {
        if (method !== 'item/tool/call') throw new Error('Esta ação exige interação no aplicativo Codex.')
        const t = handlers.get(params.tool)
        if (!t) throw new Error('Ferramenta indisponível.')
        const permission = await options.canUseTool(t.canonical, params.arguments, {})
        if (permission.behavior !== 'allow') return { success: false, contentItems: [{ type: 'inputText', text: permission.message ?? 'Ação não permitida.' }] }
        try {
          const result = await t.handler(t.schema.parse(params.arguments))
          return {
            success: !result.isError,
            contentItems: (result.content ?? []).map(c => c.type === 'image'
              ? { type: 'inputImage', imageUrl: `data:${c.mimeType};base64,${c.data}` }
              : { type: 'inputText', text: c.text ?? JSON.stringify(c) }),
          }
        } catch (e) { return { success: false, contentItems: [{ type: 'inputText', text: e.message }] } }
      })
      const inventory = await client.request('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly' })
      const native = (inventory.data ?? []).filter(s => Object.keys(s.tools ?? {}).length > 0).map(s => ({ name: s.name, status: 'connected' }))
      const local = Object.entries(options.mcpServers).filter(([, s]) => s.type === 'local').map(([name]) => ({ name, status: 'connected' }))
      emit({ type: 'system', subtype: 'init', mcp_servers: [...local, ...native] })
      for await (const user of prompt) {
        if (cancelled) break
        const completed = new Promise(resolve => { finish = resolve })
        turnCompletion = completed
        await client.request('turn/start', { threadId, input: [{ type: 'text', text: user.message.content }], effort: user.effort ?? options.effort ?? 'high' })
        await completed
        turnCompletion = null
      }
    } catch (e) {
      console.error('[jarvis] Codex:', e.message)
      emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [e.message] })
    } finally {
      client.listeners.delete(listener)
      if (threadId) client.handlers.delete(threadId)
      if (threadId && options.releaseThread) void client.request('thread/unsubscribe', { threadId }, 5000).catch(() => {})
      ended = true; wake?.()
    }
  }
  void run()
  return {
    async *[Symbol.asyncIterator]() {
      while (!ended || events.length) {
        if (events.length) yield events.shift()
        else await new Promise(resolve => { wake = resolve })
      }
    },
    async interrupt() {
      if (threadId && activeTurn) {
        const stopped = turnCompletion
        await client.request('turn/interrupt', { threadId, turnId: activeTurn }, 10000)
        if (stopped) await stopped
      }
    },
    close() { cancelled = true; void this.interrupt().catch(() => {}); finish?.() },
  }
}
