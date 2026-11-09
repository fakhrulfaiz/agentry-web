import { getConfig } from '@/config/env'
import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { authFailure, requireCredential } from '@/server/require-auth'
import { signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AGENTS_PAGE = 100

/**
 * Models the composer offers (ruling R4): `AGENTRY_WEB_MODELS` first (its first
 * entry is the default), then the distinct `model` of the user's saved agents
 * (`GET /v1/agents`), de-duplicated. When Agentry cannot be reached the
 * configured list is still returned; with no configured list that is a 502.
 */
export async function GET(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }

  const configured = getConfig().models
  let saved: string[] = []
  try {
    const upstream = await fetch(agentryUrl('/agents', `?limit=${AGENTS_PAGE}`), {
      headers: agentryHeaders(auth.authorization, { accept: 'application/json' }),
      signal: req.signal,
      cache: 'no-store',
    })
    if (upstream.status === 401) {
      await upstream.body?.cancel()
      return signedOut(auth.session)
    }
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
    const body = (await upstream.json()) as { data?: Array<{ model?: unknown }> }
    saved = (body.data ?? []).flatMap((agent) => (typeof agent.model === 'string' && agent.model ? [agent.model] : []))
  } catch (error) {
    if (req.signal.aborted) throw error
    if (configured.length === 0) return jsonError(502, 'upstream_unavailable')
  }

  const models = [...new Set([...configured, ...saved])]
  return Response.json({ models }, { headers: { 'cache-control': 'no-store' } })
}
