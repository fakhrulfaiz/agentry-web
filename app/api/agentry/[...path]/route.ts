import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath, ID_SEGMENT } from '@/server/allowlist'
import { withAgentConnectorNote } from '@/server/agent-connectors'
import { checkCsrf } from '@/server/csrf'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PREFIX = '/api/agentry'
const STATE_CHANGING = new Set(['POST', 'DELETE'])

/** Session create with a saved agent: adds the agent's soft app limit to the instructions. */
async function withAgentNote(authorization: string, body: ArrayBuffer): Promise<ArrayBuffer> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return body
  }
  const next = await withAgentConnectorNote(parsed, async (id) => {
    if (!ID_SEGMENT.test(id)) return null
    try {
      const res = await fetch(agentryUrl(`/agents/${id}`), { headers: agentryHeaders(authorization, { accept: 'application/json' }), cache: 'no-store' })
      return res.ok ? ((await res.json()) as { instructions?: string | null; metadata?: Record<string, string> | null }) : null
    } catch {
      return null
    }
  })
  return next === parsed ? body : (new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer)
}

/**
 * Allow-listed proxy to Agentry `/v1`. Builds fresh upstream headers, so the
 * browser's cookies and authorization never reach Agentry.
 */
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const raw = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : ''
  const path = allowedPath(req.method, raw)
  if (!path) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (STATE_CHANGING.has(req.method) && !checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')

  const extra: Record<string, string> = { accept: req.method === 'GET' && path.endsWith('/content') ? '*/*' : 'application/json' }
  const type = req.headers.get('content-type')
  if (type) extra['content-type'] = type
  let body = req.method === 'GET' ? undefined : await req.arrayBuffer()
  if (body && req.method === 'POST' && path === '/agents/sessions') body = await withAgentNote(auth.authorization, body)

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(path, url.search), {
      method: req.method,
      headers: agentryHeaders(auth.authorization, extra),
      body: body && body.byteLength > 0 ? body : undefined,
      signal: req.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (req.signal.aborted) throw error
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401) {
    await upstream.body?.cancel()
    return signedOut(auth.session)
  }
  return relay(upstream, path.endsWith('/content') ? { 'x-content-type-options': 'nosniff' } : {})
}

export const GET = handle
export const POST = handle
export const DELETE = handle
export const PUT = handle
export const PATCH = handle
