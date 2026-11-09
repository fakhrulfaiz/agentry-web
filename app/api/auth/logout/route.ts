import { cookies } from 'next/headers'
import { getConfig } from '@/config/env'
import { jsonError } from '@/server/agentry'
import { checkCsrf } from '@/server/csrf'
import { endSessionUrl } from '@/server/keycloak'
import { getSession } from '@/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AUTHJS_COOKIE = /^(__Secure-|__Host-)?authjs\./

/**
 * Sign-out (same-origin + CSRF header). Clears the session and answers
 * `{ redirectTo }`: Keycloak's end-session endpoint with `id_token_hint` in
 * keycloak mode, `/login` in apikey mode.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession()
  if (!checkCsrf(req, session)) return jsonError(403, 'forbidden')

  const credential = session.credential
  session.destroy()
  const store = await cookies()
  for (const { name } of store.getAll()) if (AUTHJS_COOKIE.test(name)) store.delete(name)

  let redirectTo = '/login'
  if (getConfig().auth === 'keycloak' && credential?.kind === 'keycloak') {
    redirectTo = endSessionUrl(credential.idToken, new URL('/login', req.url).toString())
  }
  return Response.json({ redirectTo }, { headers: { 'cache-control': 'no-store' } })
}
