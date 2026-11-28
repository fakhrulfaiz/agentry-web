import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath } from '@/server/allowlist'
import { checkCsrf } from '@/server/csrf'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PREFIX = '/api/agentry'
const STATE_CHANGING = new Set(['POST', 'DELETE'])

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
  // Bodies pass through unchanged: the API adds connectors and enforces app grants itself.
  const body = req.method === 'GET' ? undefined : await req.arrayBuffer()

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
