export const DEFAULT_CONNECTORS_MCP_URL = 'https://connect.composio.dev/mcp'

/**
 * Adds the connectors MCP tool (with the owner's key in its headers) to a
 * session-create body's `agent.tools`. Returns the body unchanged when it has
 * no inline `agent` object; never adds a second `composio` entry.
 */
export function withConnectorTool(body: unknown, key: string, serverUrl: string = DEFAULT_CONNECTORS_MCP_URL): unknown {
  if (typeof body !== 'object' || body === null) return body
  const agent = (body as { agent?: unknown }).agent
  if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return body
  const tools = (agent as { tools?: unknown }).tools
  const list = Array.isArray(tools) ? tools : []
  if (list.some((t) => typeof t === 'object' && t !== null && (t as { server_label?: unknown }).server_label === 'composio')) return body
  const tool = {
    type: 'mcp',
    server_label: 'composio',
    transport: { type: 'http', server_url: serverUrl, headers: { 'x-consumer-api-key': key } },
  }
  return { ...body, agent: { ...agent, tools: [...list, tool] } }
}
