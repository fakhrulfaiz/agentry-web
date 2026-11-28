import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { ID_SEGMENT } from '@/server/allowlist'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE passthrough of `GET /v1/agents/environments/{id}/terminals/{tid}/stream` (a sandbox
 * terminal's output). The upstream body is piped through unbuffered and
 * the upstream fetch is aborted when the browser disconnects.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; tid: string }> }): Promise<Response> {
  const { id, tid } = await ctx.params
  if (!ID_SEGMENT.test(id) || !ID_SEGMENT.test(tid)) return jsonError(404, 'not_found')

  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  const extra: Record<string, string> = { accept: 'text/event-stream' }

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(`/agents/environments/${id}/terminals/${tid}/stream`), {
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
  if (!upstream.ok) return relay(upstream)

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream',
      // no-transform keeps compression from buffering the stream.
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
