import { connectedSlugs } from '@/server/connector-inventory'
import { connectionSnapshot } from '@/server/connections'
import { getKey, ownerOf } from '@/server/connectors-store'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * `{ connected, checkedAt, stale, problem? }`: slugs with an active account
 * (null when unknown), when that was checked, and why it is unknown
 * (`rejected` key or Composio `unavailable`). `?refresh=1` checks now.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const { session } = await requireCredential()
    const owner = ownerOf(session.identity)
    const key = await getKey(owner)
    if (!key) return Response.json({ connected: null, checkedAt: 0, stale: false }, { headers: NO_STORE })
    const force = new URL(req.url).searchParams.get('refresh') === '1'
    const snap = await connectionSnapshot(owner, key, force)
    return Response.json(
      { connected: snap.inventory ? connectedSlugs(snap.inventory) : null, checkedAt: snap.checkedAt, stale: snap.stale, ...(snap.problem ? { problem: snap.problem } : {}) },
      { headers: NO_STORE },
    )
  } catch (error) {
    return authFailure(error)
  }
}
