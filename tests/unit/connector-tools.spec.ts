import { describe, expect, it } from 'vitest'
import { DEFAULT_CONNECTORS_MCP_URL, withConnectorTool } from '@/server/connector-tools'

const tool = (url: string) => ({
  type: 'mcp',
  server_label: 'composio',
  // Optional: a Composio hiccup must not stop the chat from starting.
  required: false,
  transport: { type: 'http', server_url: url, headers: { 'x-consumer-api-key': 'ck_test_123' } },
})

describe('withConnectorTool', () => {
  it('creates agent.tools when missing', () => {
    expect(withConnectorTool({ agent: { model: 'm' }, x: 1 }, 'ck_test_123')).toEqual({
      agent: { model: 'm', tools: [tool(DEFAULT_CONNECTORS_MCP_URL)] },
      x: 1,
    })
  })

  it('appends to existing tools and honors the server URL', () => {
    const out = withConnectorTool({ agent: { tools: [{ type: 'function' }] } }, 'ck_test_123', 'http://mcp.test') as {
      agent: { tools: unknown[] }
    }
    expect(out.agent.tools).toEqual([{ type: 'function' }, tool('http://mcp.test')])
  })

  it('does not add a second entry', () => {
    const body = { agent: { tools: [tool('http://old')] } }
    expect(withConnectorTool(body, 'ck_test_123')).toBe(body)
  })

  it.each([null, 'text', { agent: 'agent_1' }, { model: 'm' }])('leaves %j unchanged', (body) => {
    expect(withConnectorTool(body, 'ck_test_123')).toBe(body)
  })
})
