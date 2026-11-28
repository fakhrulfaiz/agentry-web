import 'server-only'
import type { IronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { jsonError } from './agentry'
import { refreshIfNeeded } from './keycloak'
import { getSession, publicIdentity, type Identity, type SessionData } from './session'

/** No usable credential: route handlers answer 401 `{ error: 'signed_out' }`. */
export class UnauthorizedError extends Error {
  constructor() {
    super('signed_out')
    this.name = 'UnauthorizedError'
  }
}

/** Keycloak could not refresh the token right now; the session is kept. Route handlers answer 503. */
export class AuthUnavailableError extends Error {
  constructor() {
    super('auth_unavailable')
    this.name = 'AuthUnavailableError'
  }
}

/**
 * For route handlers: the session and the `Authorization` value for Agentry.
 * Refreshes a Keycloak token that expires within 60s. A refused refresh
 * (Keycloak 400/401) clears the session and throws `UnauthorizedError`; an
 * unreachable or failing Keycloak keeps the session and throws
 * `AuthUnavailableError`. Throws `UnauthorizedError` when signed out.
 */
export async function requireCredential(): Promise<{ session: IronSession<SessionData>; authorization: string }> {
  const session = await getSession()
  const credential = session.credential
  if (!credential) throw new UnauthorizedError()
  if (credential.kind === 'apikey') return { session, authorization: `Bearer ${credential.key}` }

  const result = await refreshIfNeeded(credential, Date.now())
  if (result.status === 'rejected') {
    session.destroy()
    throw new UnauthorizedError()
  }
  if (result.status === 'unavailable') throw new AuthUnavailableError()
  const fresh = result.credential
  if (fresh !== credential) {
    session.credential = fresh
    await session.save()
  }
  return { session, authorization: `Bearer ${fresh.accessToken}` }
}

/**
 * The answer for a `requireCredential` failure: 401 `signed_out` or 503
 * `auth_unavailable`. Anything else is rethrown.
 */
export function authFailure(error: unknown): Response {
  if (error instanceof UnauthorizedError) return jsonError(401, 'signed_out')
  if (error instanceof AuthUnavailableError) return jsonError(503, 'auth_unavailable')
  throw error
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

/**
 * For pages, which cannot write cookies: the `Authorization` value for Agentry when it can be used
 * as is (an API key, or a Keycloak token valid for at least 10 more seconds); `undefined` otherwise
 * (signed out, or a token that needs a refresh, which a route handler does).
 */
export async function pageAuthorization(): Promise<string | undefined> {
  const credential = (await getSession()).credential
  if (!credential) return undefined
  if (credential.kind === 'apikey') return `Bearer ${credential.key}`
  return credential.expiresAt - Date.now() > 10_000 ? `Bearer ${credential.accessToken}` : undefined
}
