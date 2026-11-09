import 'server-only'
import type { IronSession } from 'iron-session'
import { jsonError } from './agentry'
import type { SessionData } from './session'

/** Agentry rejected the credential: clear the session so the client lands on `/login`. */
export function signedOut(session?: IronSession<SessionData>): Response {
  session?.destroy()
  return jsonError(401, 'signed_out')
}

/** Copies an upstream response's status, content type and body. */
export function relay(upstream: Response, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({ 'cache-control': 'no-store', ...extraHeaders })
  const type = upstream.headers.get('content-type')
  if (type) headers.set('content-type', type)
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}
