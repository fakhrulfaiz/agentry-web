import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath, ID_SEGMENT } from '@/server/allowlist'
import { sanitizeArtifactSegments } from '@/server/artifact-bytes'
import { authFailure, requireCredential } from '@/server/require-auth'
import { signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One skill file as JSON text (`/agents/skills/view/{name}/files/{path}`). The allow-list
 * keeps the listing route only, so this route validates the decoded catch-all segments itself.
 */
export async function GET(req: Request, ctx: { params: Promise<{ name: string; path: string[] }> }): Promise<Response> {
  const { name, path: segments } = await ctx.params
  if (sanitizeArtifactSegments(segments) === undefined || !ID_SEGMENT.test(name) || allowedPath('GET', `/agents/skills/view/${name}`) === null) {
    return jsonError(404, 'not_found')
  }
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  const upstreamPath = `/agents/skills/view/${encodeURIComponent(name)}/files/${segments.map((s) => encodeURIComponent(s)).join('/')}`
  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(upstreamPath), { method: 'GET', headers: agentryHeaders(auth.authorization, { accept: 'application/json' }), signal: req.signal, cache: 'no-store' })
  } catch (error) {
    if (req.signal.aborted) throw error
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401) {
    await upstream.body?.cancel()
    return signedOut(auth.session)
  }
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
