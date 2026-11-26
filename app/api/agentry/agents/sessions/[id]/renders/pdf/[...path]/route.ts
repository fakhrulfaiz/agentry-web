import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { ID_SEGMENT } from '@/server/allowlist'
import { sanitizeArtifactSegments } from '@/server/artifact-bytes'
import { authFailure, requireCredential } from '@/server/require-auth'
import { signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * An Office file of the session rendered as PDF by the API
 * (`/agents/sessions/{id}/renders/pdf/{path}`). Validates the decoded
 * segments like the artifacts route, forwards `If-None-Match`, and passes
 * `ETag`, `X-Agentry-Missing-Fonts` and 304 through so a reopen without
 * changes comes from the browser cache.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> {
  const { id, path: segments } = await ctx.params
  if (sanitizeArtifactSegments(segments) === undefined || !ID_SEGMENT.test(id)) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  const upstreamPath = `/agents/sessions/${encodeURIComponent(id)}/renders/pdf/${segments.map((s) => encodeURIComponent(s)).join('/')}`
  const extra: Record<string, string> = { accept: 'application/pdf, application/json' }
  const match = req.headers.get('if-none-match')
  if (match) extra['if-none-match'] = match

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(upstreamPath), {
      method: 'GET',
      headers: agentryHeaders(auth.authorization, extra),
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
  const name = (segments.at(-1) ?? 'document').replace(/\.[^.]*$/, '').replace(/["\\\r\n]/g, '_')
  const headers = new Headers({ 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' })
  for (const h of ['etag', 'x-agentry-missing-fonts', 'retry-after']) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (upstream.status === 304) {
    await upstream.body?.cancel()
    return new Response(null, { status: 304, headers })
  }
  if (upstream.ok) {
    headers.set('content-type', 'application/pdf')
    headers.set('content-disposition', `inline; filename="${name}.pdf"`)
    const length = upstream.headers.get('content-length')
    if (length) headers.set('content-length', length)
  } else {
    headers.set('content-type', 'application/json')
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
