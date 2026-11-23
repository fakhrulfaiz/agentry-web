import { getCatalog } from '@/server/connector-catalog'
import { cachedConnectedToolkits } from '@/server/connector-status'
import { getKey, ownerOf } from '@/server/connectors-store'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

/** `{ connected }`: slugs with an active account, or null when that is unknown. Loaded after the page paints. */
export async function GET(): Promise<Response> {
  try {
    const { session } = await requireCredential()
    const owner = ownerOf(session.identity)
    const key = await getKey(owner)
    if (!key) return Response.json({ connected: null }, { headers: NO_STORE })
    const catalog = await getCatalog()
    const set = await cachedConnectedToolkits(owner, key, catalog.entries.map((e) => e.slug))
    return Response.json({ connected: set ? [...set] : null }, { headers: NO_STORE })
  } catch (error) {
    return authFailure(error)
  }
}
