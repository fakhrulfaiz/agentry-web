import 'server-only'
import type { IronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { refreshIfNeeded } from './keycloak'
import { getSession, publicIdentity, type Identity, type SessionData } from './session'

/** No usable credential: route handlers answer 401 `{ error: 'signed_out' }`. */
export class UnauthorizedError extends Error {
  constructor() {
    super('signed_out')
    this.name = 'UnauthorizedError'
  }
}

/**
 * For route handlers: the session and the `Authorization` value for Agentry.
 * Refreshes a Keycloak token that expires within 60s; a failed refresh clears
 * the session. Throws `UnauthorizedError` when signed out.
 */
export async function requireCredential(): Promise<{ session: IronSession<SessionData>; authorization: string }> {
  const session = await getSession()
  const credential = session.credential
  if (!credential) throw new UnauthorizedError()
  if (credential.kind === 'apikey') return { session, authorization: `Bearer ${credential.key}` }

  const fresh = await refreshIfNeeded(credential, Date.now())
  if (!fresh || fresh.kind !== 'keycloak') {
    session.destroy()
    throw new UnauthorizedError()
  }
  if (fresh !== credential) {
    session.credential = fresh
    await session.save()
  }
  return { session, authorization: `Bearer ${fresh.accessToken}` }
}

/**
 * For pages and layouts (which cannot write cookies): redirects to `/login`
 * when signed out. Returns only browser-safe data: the identity and the CSRF
 * token for the `<meta name="agentry-csrf">` tag.
 */
export async function requirePageSession(): Promise<{ identity: Identity; csrf: string }> {
  const session = await getSession()
  const identity = publicIdentity(session)
  if (!identity || !session.csrf) redirect('/login')
  return { identity, csrf: session.csrf }
}
