import 'server-only'

const MCP_URL = 'https://connect.composio.dev/mcp'
const TIMEOUT_MS = 8_000
const CACHE_MS = 3 * 60_000

/** Reads the first JSON-RPC message from a plain JSON or SSE (`data:` lines) response body. */
export function parseRpcBody(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:') && line.slice(5).trim().startsWith('{')) return JSON.parse(line.slice(5))
  }
  throw new Error('no JSON-RPC message in response')
}

/**
 * Slugs with at least one active account in a `COMPOSIO_MANAGE_CONNECTIONS` list result.
 * Throws when the call did not succeed, so callers can tell "none connected" from "unknown".
 */
export function parseConnected(message: unknown): Set<string> {
  const rpc = message as { error?: unknown; result?: { isError?: boolean; content?: { text?: unknown }[] } }
  const text = rpc.result?.content?.[0]?.text
  if (rpc.error || rpc.result?.isError || typeof text !== 'string') throw new Error('list call failed')
  const payload = JSON.parse(text) as {
    successful?: boolean
    data?: { results?: Record<string, { accounts?: { status?: string }[] }> }
  }
  if (!payload.successful || !payload.data?.results) throw new Error('list call unsuccessful')
  const connected = new Set<string>()
  for (const [slug, result] of Object.entries(payload.data.results)) {
    if (result.accounts?.some((a) => a.status === 'active')) connected.add(slug)
  }
  return connected
}

async function rpc(key: string, body: unknown, session?: string): Promise<Response> {
  return fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-consumer-api-key': key,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

export type ListResult = { ok: true; message: unknown } | { ok: false; reason: 'rejected' | 'unavailable' }

/** Composio answers 401/403 when the consumer key is wrong or revoked. */
const refused = (res: Response) => res.status === 401 || res.status === 403

export async function listConnectionsResult(key: string, slugs: string[]): Promise<ListResult> {
  try {
    const init = await rpc(key, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agentry-web', version: '1' } },
    })
    if (!init.ok) return { ok: false, reason: refused(init) ? 'rejected' : 'unavailable' }
    const session = init.headers.get('mcp-session-id') ?? undefined
    const res = await rpc(
      key,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'COMPOSIO_MANAGE_CONNECTIONS',
          arguments: { toolkits: slugs.map((name) => ({ name, action: 'list' })) },
        },
      },
      session,
    )
    if (!res.ok) return { ok: false, reason: refused(res) ? 'rejected' : 'unavailable' }
    return { ok: true, message: parseRpcBody(await res.text()) }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** `listConnectionsResult` as the message, or null on any failure. */
export async function listConnections(key: string, slugs: string[]): Promise<unknown | null> {
  const result = await listConnectionsResult(key, slugs)
  return result.ok ? result.message : null
}

/**
 * Which of `slugs` the key's owner has an active account for, or null when that cannot be
 * determined (network, auth, timeout or unexpected response).
 */
export async function connectedToolkits(key: string, slugs: string[]): Promise<Set<string> | null> {
  const message = await listConnections(key, slugs)
  if (message === null) return null
  try {
    return parseConnected(message)
  } catch {
    // Any failure means status is unknown; the page then shows Connect, never a wrong status.
    return null
  }
}
