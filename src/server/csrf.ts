import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IronSession } from 'iron-session'
import type { SessionData } from './session'

export const CSRF_HEADER = 'x-agentry-csrf'

/** Returns the session's CSRF token, creating one (32 random bytes, base64url) if absent. Call `save()` afterwards. */
export function ensureCsrf(session: IronSession<SessionData>): string {
  if (!session.csrf) session.csrf = randomBytes(32).toString('base64url')
  return session.csrf
}

/**
 * True when the request's `Origin` names this host. Requests without an
 * `Origin` (or with `Origin: null`) are rejected.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') return false
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.host.toLowerCase() === host.split(',')[0].trim().toLowerCase()
  } catch {
    return false
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Same-origin request carrying an `x-agentry-csrf` header that matches the session's token. */
export function checkCsrf(req: Request, session: Partial<SessionData>): boolean {
  const header = req.headers.get(CSRF_HEADER)
  if (!header || !session.csrf) return false
  return safeEqual(header, session.csrf) && isSameOrigin(req)
}
