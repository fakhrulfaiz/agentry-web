import { connectionSnapshot } from '@/server/connections'
import { getKey, ownerOf } from '@/server/connectors-store'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

/** `{ data }`: each app's accounts (id, alias, status) and whether one is active; `data: null` when unknown. */
export async function GET(): Promise<Response> {
  try {
    const { session } = await requireCredential()
    const owner = ownerOf(session.identity)
    const key = await getKey(owner)
    if (!key) return Response.json({ data: null }, { headers: NO_STORE })
    return Response.json({ data: (await connectionSnapshot(owner, key)).inventory }, { headers: NO_STORE })
  } catch (error) {
    return authFailure(error)
  }
}
