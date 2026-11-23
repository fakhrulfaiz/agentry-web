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

/**
 * Which of `slugs` the key's owner has an active account for, or null when that cannot be
 * determined (network, auth, timeout or unexpected response). Uses only `action: "list"`,
 * which has no side effects; the default `add` action would create a connection link.
 * One call covers the whole catalog.
 */
/**
 * The raw `COMPOSIO_MANAGE_CONNECTIONS` list result for `slugs` (JSON-RPC message), or null when
 * the service could not be reached. Uses only `action: "list"`, which has no side effects; the
 * default `add` action would create a connection link. One call covers the whole catalog.
 */
export async function listConnections(key: string, slugs: string[]): Promise<unknown | null> {
  try {
    const init = await rpc(key, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agentry-web', version: '1' } },
    })
    if (!init.ok) return null
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
    if (!res.ok) return null
    return parseRpcBody(await res.text())
  } catch {
    return null
  }
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

const cache = new Map<string, { at: number; value: Set<string> }>()

/** `connectedToolkits` cached per owner for a few minutes; failures are not cached. */
export async function cachedConnectedToolkits(owner: string, key: string, slugs: string[]): Promise<Set<string> | null> {
  const hit = cache.get(owner)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = await connectedToolkits(key, slugs)
  if (value) cache.set(owner, { at: Date.now(), value })
  return value
}

/** Drops the owner's cached status; call when their key is replaced or removed. */
export function forgetConnectedToolkits(owner: string): void {
  cache.delete(owner)
}
