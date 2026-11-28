import { connectedSlugs } from '@/server/connector-inventory'
import { keyStatus } from '@/server/connector-key-upstream'
import { cacheOwner, connectionSnapshot, keyStamp } from '@/server/connections'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }
const UNKNOWN = { connected: null, checkedAt: 0, stale: false }

/**
 * `{ connected, checkedAt, stale, problem? }`: slugs with an active account
 * (null when unknown), when that was checked, and why it is unknown
 * (`rejected` key or Composio `unavailable`). `?refresh=1` checks now.
 * The API holds the key and asks Composio.
 */
export async function GET(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  const status = await keyStatus(auth.authorization).catch(() => null)
  if (!status?.configured) return Response.json(UNKNOWN, { headers: NO_STORE })
  const force = new URL(req.url).searchParams.get('refresh') === '1'
  const snap = await connectionSnapshot(cacheOwner(auth.session), keyStamp(status), auth.authorization, force)
  return Response.json(
    { connected: snap.inventory ? connectedSlugs(snap.inventory) : null, checkedAt: snap.checkedAt, stale: snap.stale, ...(snap.problem ? { problem: snap.problem } : {}) },
    { headers: NO_STORE },
  )
}
