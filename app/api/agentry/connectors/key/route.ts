import { forgetConnectedAccounts } from '@/server/connector-inventory'
import { jsonError } from '@/server/agentry'
import { checkCsrf } from '@/server/csrf'
import { forgetConnectedToolkits } from '@/server/connector-status'
import { hasKey, InvalidConnectorKeyError, ownerOf, removeKey, setKey } from '@/server/connectors-store'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

/** `{ configured }` for the signed-in user; the key itself is never returned. */
export async function GET(): Promise<Response> {
  try {
    const { session } = await requireCredential()
    return Response.json({ configured: await hasKey(ownerOf(session.identity)) }, { headers: NO_STORE })
  } catch (error) {
    return authFailure(error)
  }
}

/** Saves or replaces the user's connector key from `{ key }`. */
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
    await setKey(ownerOf(auth.session.identity), body.key)
    forgetConnectedToolkits(ownerOf(auth.session.identity))
  forgetConnectedAccounts(ownerOf(auth.session.identity))
    forgetConnectedAccounts(ownerOf(auth.session.identity))
  } catch (error) {
    if (error instanceof InvalidConnectorKeyError) return jsonError(400, 'invalid_key')
    throw error
  }
  return Response.json({ configured: true }, { headers: NO_STORE })
}

/** Removes the user's connector key. */
export async function DELETE(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')
  await removeKey(ownerOf(auth.session.identity))
  forgetConnectedToolkits(ownerOf(auth.session.identity))
  forgetConnectedAccounts(ownerOf(auth.session.identity))
  return Response.json({ configured: false }, { headers: NO_STORE })
}
