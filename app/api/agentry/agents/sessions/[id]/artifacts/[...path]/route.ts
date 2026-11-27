import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { allowedPath } from '@/server/allowlist'
import { artifactContentType, artifactDisposition, sanitizeArtifactSegments } from '@/server/artifact-bytes'
import { parseRange, sliceStream } from '@/server/byte-range'
import { authFailure, requireCredential } from '@/server/require-auth'
import { signedOut } from '@/server/upstream'
import { ID_SEGMENT } from '@/server/allowlist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Streams one artifact's bytes (`/agents/sessions/{id}/artifacts/{path}`). The
 * allow-list keeps the listing route only, so this route validates the decoded
 * catch-all segments itself and derives the browser-facing `Content-Type` and
 * `Content-Disposition` — the upstream answers `application/octet-stream` for
 * every file. A single `Range` is answered from the streamed body (`206`), so
 * videos can seek.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> {
  const { id, path: segments } = await ctx.params
  const relative = sanitizeArtifactSegments(segments)
  const apiPath = allowedPath('GET', `/agents/sessions/${id}/artifacts`)
  if (relative === undefined || apiPath === null || !ID_SEGMENT.test(id)) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  const upstreamPath = `/agents/sessions/${encodeURIComponent(id)}/artifacts/${segments
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
  const name = segments.at(-1) ?? ''
  const download = new URL(req.url).searchParams.has('download')

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(upstreamPath), {
      method: 'GET',
      headers: agentryHeaders(auth.authorization, { accept: '*/*' }),
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
  const headers = new Headers({
    'content-type': upstream.ok ? artifactContentType(name) : 'application/json',
    'content-disposition': upstream.ok ? artifactDisposition(name, download) : 'inline',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  const length = upstream.headers.get('content-length')
  if (upstream.ok && length) {
    headers.set('content-length', length)
    headers.set('accept-ranges', 'bytes')
    const size = Number(length)
    const range = parseRange(req.headers.get('range'), size)
    if (range === 'unsatisfiable') {
      await upstream.body?.cancel()
      headers.set('content-range', `bytes */${length}`)
      headers.delete('content-length')
      return new Response(null, { status: 416, headers })
    }
    if (range !== undefined && upstream.body !== null && upstream.status === 200) {
      headers.set('content-range', `bytes ${String(range.start)}-${String(range.end)}/${length}`)
      headers.set('content-length', String(range.end - range.start + 1))
      return new Response(sliceStream(upstream.body, range.start, range.end), { status: 206, headers })
    }
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}
