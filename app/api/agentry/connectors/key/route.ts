import { jsonError } from '@/server/agentry'
import { checkCsrf } from '@/server/csrf'
import { cacheOwner, connections } from '@/server/connections'
import { ConnectorKeyError, currentKeyStatus, removeKey, saveKey, type ConnectorKeyStatus } from '@/server/connector-key-upstream'
import { ownerOf, removeKey as removeFileKey } from '@/server/connectors-store'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

const answer = (status: ConnectorKeyStatus) => Response.json({ configured: status.configured, last4: status.last4, updated_at: status.updated_at }, { headers: NO_STORE })

/** An API refusal passes through with its code (`invalid_key`, `secrets_disabled`); anything else is 502. */
function upstreamFailure(error: unknown): Response {
  if (error instanceof ConnectorKeyError && (error.status < 500 || error.status === 501)) return jsonError(error.status, error.code)
  return jsonError(502, 'upstream_unavailable')
}

/**
 * `{ configured, last4, updated_at }` from the API, which holds the key; the key itself is never
 * returned. A key still in the web app's old file store is moved to the API here.
 */
export async function GET(): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  try {
    return answer(await currentKeyStatus(ownerOf(auth.session.identity), auth.authorization))
  } catch (error) {
    return upstreamFailure(error)
  }
}

/** Saves or replaces the user's connector key from `{ key }` (sent to the API, which seals it). */
export async function PUT(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null
  if (typeof body?.key !== 'string') return jsonError(400, 'invalid_key')
  try {
    const status = await saveKey(auth.authorization, body.key)
    connections.forget(cacheOwner(auth.session))
    return answer(status)
  } catch (error) {
    return upstreamFailure(error)
  }
}

/** Removes the user's connector key in the API and any copy left in the old file store. */
export async function DELETE(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')
  try {
    const status = await removeKey(auth.authorization)
    await removeFileKey(ownerOf(auth.session.identity)).catch(() => undefined)
    connections.forget(cacheOwner(auth.session))
    return answer(status)
  } catch (error) {
    return upstreamFailure(error)
  }
}
