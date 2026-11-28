import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath } from '@/server/allowlist'
import { authFailure, requireCredential } from '@/server/require-auth'
import { signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Streams a files-only snapshot's tar.gz (`/agents/environments/snapshots/{id}/content`) so a plain link
 * downloads it. Keeps the upstream `Content-Length` (the browser can show progress) and the attachment filename.
 */
export async function GET(req: Request, ctx: { params: Promise<{ sid: string }> }): Promise<Response> {
  const { sid } = await ctx.params
  const path = allowedPath('GET', `/agents/environments/snapshots/${sid}/content`)
  if (path === null) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(path), { method: 'GET', headers: agentryHeaders(auth.authorization, { accept: '*/*' }), signal: req.signal, cache: 'no-store' })
  } catch (error) {
    if (req.signal.aborted) throw error
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401) {
    await upstream.body?.cancel()
    return signedOut(auth.session)
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  headers.set('content-type', upstream.ok ? 'application/gzip' : (upstream.headers.get('content-type') ?? 'application/json'))
  for (const name of upstream.ok ? ['content-length', 'content-disposition'] : []) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (upstream.ok && !headers.has('content-disposition')) headers.set('content-disposition', 'attachment; filename="snapshot.tar.gz"')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}
