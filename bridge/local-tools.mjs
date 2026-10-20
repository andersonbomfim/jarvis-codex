// Tool definitions shared with the Codex app-server adapter. No Claude runtime.
import { z } from 'zod'

export function tool(name, description, shape, handler) {
  const schema = z.object(shape)
  return {
    name, description, schema, handler,
    inputSchema: z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }),
  }
}

export function createSdkMcpServer({ name, tools, instructions = '' }) {
  return { type: 'local', name, tools, instructions }
}
