import { keyStatus } from '@/server/connector-key-upstream'
import { cacheOwner, connectionSnapshot, keyStamp } from '@/server/connections'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

/** `{ data }`: each app's accounts (id, alias, status) and whether one is active; `data: null` when unknown. */
export async function GET(): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  const status = await keyStatus(auth.authorization).catch(() => null)
  if (!status?.configured) return Response.json({ data: null }, { headers: NO_STORE })
  const snap = await connectionSnapshot(cacheOwner(auth.session), keyStamp(status), auth.authorization)
  return Response.json({ data: snap.inventory }, { headers: NO_STORE })
}
