import { getConfig } from '@/config/env'
import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { ensureCsrf, isSameOrigin } from '@/server/csrf'
import { getSession, type Identity } from '@/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Display identity when Agentry does not expose the key's principal. */
const API_KEY_IDENTITY: Identity = { owner: '', roles: [], displayName: 'API key user' }

function principalOf(body: unknown): Identity | null {
  const principal = (body as { principal?: { owner?: unknown; roles?: unknown } } | null)?.principal
  if (!principal || typeof principal.owner !== 'string') return null
  const roles = Array.isArray(principal.roles) ? principal.roles.filter((r): r is string => typeof r === 'string') : []
  return { owner: principal.owner, roles, displayName: principal.owner }
}

/** apikey sign-in: validates `{ key }` with one Agentry call, then stores it only in the encrypted session. */
export async function POST(req: Request): Promise<Response> {
  if (getConfig().auth !== 'apikey') return jsonError(404, 'not_found')
  if (!isSameOrigin(req)) return jsonError(403, 'forbidden')

  let key: unknown
  try {
    key = ((await req.json()) as { key?: unknown } | null)?.key
  } catch {
    return jsonError(400, 'invalid_request')
  }
  if (typeof key !== 'string' || key.trim() === '') return jsonError(400, 'invalid_request')
  key = key.trim()

  let upstream: Response
  try {
    upstream = await fetch(agentryUrl('/agents', '?limit=1'), {
      headers: agentryHeaders(`Bearer ${key as string}`, { accept: 'application/json' }),
      cache: 'no-store',
    })
  } catch {
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401 || upstream.status === 403) return jsonError(401, 'invalid_key')
  if (!upstream.ok) return jsonError(502, 'upstream_error')
  const body: unknown = await upstream.json().catch(() => null)

  const session = await getSession()
  session.credential = { kind: 'apikey', key: key as string }
  session.identity = principalOf(body) ?? API_KEY_IDENTITY
  delete session.csrf
  ensureCsrf(session)
  await session.save()

  return new Response(null, { status: 303, headers: { location: '/', 'cache-control': 'no-store' } })
}
