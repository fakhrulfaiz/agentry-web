import 'server-only'
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'
import { cookies, headers } from 'next/headers'
import { getConfig, type WebConfig } from '@/config/env'

export const SESSION_COOKIE = 'agentry_session'

/** Agentry credential; lives only inside the encrypted session cookie. */
export type Credential =
  | { kind: 'apikey'; key: string }
  /** `expiresAt` is the access token's expiry in epoch milliseconds. */
  | { kind: 'keycloak'; accessToken: string; refreshToken: string; expiresAt: number; idToken: string }

export interface Identity {
  owner: string
  roles: string[]
  displayName: string
}

export interface SessionData {
  credential?: Credential
  identity?: Identity
  csrf: string
}

/**
 * Whether the session cookie is `Secure`. Outside production never (plain
 * `next dev`). In production with `AGENTRY_WEB_COOKIE_SECURE=auto` (default)
 * only when the request came over HTTPS, so a deployment reached over plain
 * HTTP (a LAN address, a container port) can still sign in, since browsers drop
 * `Secure` cookies on `http://` except for localhost; `always` sets it on every
 * request, for a TLS proxy that does not forward the protocol.
 * @param forwardedProto - the request's `X-Forwarded-Proto` (a proxy's, else
 *   the one Next sets from the connection); the first value counts.
 */
export function cookieIsSecure(config: Pick<WebConfig, 'production' | 'cookieSecure'>, forwardedProto: string | null): boolean {
  if (!config.production) return false
  if (config.cookieSecure === 'always') return true
  return forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https'
}

export function sessionOptions(secure: boolean): SessionOptions {
  const config = getConfig()
  return {
    cookieName: SESSION_COOKIE,
    password: config.sessionSecret,
    // Keycloak access, refresh and id tokens together exceed one 4 KB cookie.
    chunk: true,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
    },
  }
}

/**
 * The encrypted `agentry_session` cookie. A tampered, expired or foreign cookie
 * reads as an empty session (signed out), never an error. Server-only.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  // Read cookies first: during a build-time prerender this bails out to dynamic
  // rendering before configuration (absent at build) is touched.
  const store = await cookies()
  const proto = (await headers()).get('x-forwarded-proto')
  return getIronSession<SessionData>(store, sessionOptions(cookieIsSecure(getConfig(), proto)))
}

/**
 * The identity shown in the browser. This is the only session data ever sent
 * to the client: it never includes the credential or the CSRF token.
 */
export function publicIdentity(s: Partial<SessionData>): Identity | null {
  if (!s.credential || !s.identity) return null
  const { owner, roles, displayName } = s.identity
  return { owner, roles: [...roles], displayName }
}
