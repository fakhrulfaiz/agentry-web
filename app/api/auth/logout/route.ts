import { cookies } from 'next/headers'
import { getConfig } from '@/config/env'
import { jsonError } from '@/server/agentry'
import { checkCsrf } from '@/server/csrf'
import { endSessionUrl } from '@/server/keycloak'
import { publicOrigin } from '@/server/origin'
import { getSession } from '@/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AUTHJS_COOKIE = /^(__Secure-|__Host-)?authjs\./

/**
 * Sign-out (same-origin + CSRF header). Clears the session and answers
 * `{ redirectTo }`: Keycloak's end-session endpoint (`client_id` +
 * `post_logout_redirect_uri`, never a token) in keycloak mode, `/login` in
 * apikey mode. The redirect URI uses the forwarded origin behind a proxy.
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
    redirectTo = endSessionUrl(`${publicOrigin(req)}/login`)
  }
  return Response.json({ redirectTo }, { headers: { 'cache-control': 'no-store' } })
}
