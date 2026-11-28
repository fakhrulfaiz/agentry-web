import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath } from '@/server/allowlist'
import { checkCsrf } from '@/server/csrf'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Uploads a files-only snapshot (`POST /agents/environments/snapshots/import?name=`). The archive can be
 * large, so the request body is passed through as a stream (the generic proxy buffers bodies). Same-origin
 * and CSRF checks apply as for every state-changing call.
 */
export async function POST(req: Request): Promise<Response> {
  if (allowedPath('POST', '/agents/environments/snapshots/import') === null) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')
  if (!req.body) return jsonError(400, 'empty_body')

  const name = new URL(req.url).searchParams.get('name')
  const extra: Record<string, string> = { accept: 'application/json', 'content-type': 'application/gzip' }
  const length = req.headers.get('content-length')
  if (length) extra['content-length'] = length

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl('/agents/environments/snapshots/import', name ? `?name=${encodeURIComponent(name)}` : ''), {
      method: 'POST',
      headers: agentryHeaders(auth.authorization, extra),
      body: req.body,
      duplex: 'half',
      signal: req.signal,
      cache: 'no-store',
    } as RequestInit)
  } catch (error) {
    if (req.signal.aborted) throw error
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401) {
    await upstream.body?.cancel()
    return signedOut(auth.session)
  }
  return relay(upstream)
}
