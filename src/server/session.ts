import 'server-only'
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { getConfig } from '@/config/env'

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

export function sessionOptions(): SessionOptions {
  const config = getConfig()
  return {
    cookieName: SESSION_COOKIE,
    password: config.sessionSecret,
    // Keycloak access, refresh and id tokens together exceed one 4 KB cookie.
    chunk: true,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
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
  return getIronSession<SessionData>(store, sessionOptions())
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
