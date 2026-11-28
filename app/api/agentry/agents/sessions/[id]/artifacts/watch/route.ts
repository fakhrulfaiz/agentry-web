import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { ID_SEGMENT } from '@/server/allowlist'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE passthrough of `GET /v1/agents/sessions/{id}/artifacts/watch`.
 * No Last-Event-ID: reconnects start a fresh watch and the client reloads the listing.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params
  if (!ID_SEGMENT.test(id)) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(`/agents/sessions/${id}/artifacts/watch`), {
      headers: agentryHeaders(auth.authorization, { accept: 'text/event-stream' }),
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
  if (!upstream.ok) return relay(upstream)

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
