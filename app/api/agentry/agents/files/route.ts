import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath } from '@/server/allowlist'
import { checkCsrf } from '@/server/csrf'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /agents/files`: forwards the multipart upload to Agentry as a stream,
 * so a file of up to the backend's limit is never held in memory here. The
 * backend enforces the size and type limits and answers 413 / 415 itself.
 */
export async function POST(req: Request): Promise<Response> {
  const path = allowedPath('POST', '/agents/files')
  if (!path) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')

  const type = req.headers.get('content-type')
  if (!type?.toLowerCase().startsWith('multipart/form-data') || !req.body) return jsonError(400, 'invalid_file')
  const extra: Record<string, string> = { accept: 'application/json', 'content-type': type }
  const length = req.headers.get('content-length')
  if (length) extra['content-length'] = length

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(path), {
      method: 'POST',
      headers: agentryHeaders(auth.authorization, extra),
      body: req.body,
      // Node's fetch needs `duplex` to stream a request body.
      duplex: 'half',
      signal: req.signal,
      cache: 'no-store',
    } as RequestInit & { duplex: 'half' })
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
