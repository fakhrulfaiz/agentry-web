import { agentryHeaders, agentryUrl } from '@/server/agentry'
import { verifyPreviewToken } from '@/server/preview-token'
import { PREVIEW_CSP, previewHeaders } from '@/server/preview-headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': PREVIEW_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } })

/** Request headers that describe the request itself; the browser's cookies and credentials never reach the app. */
const FORWARD = ['accept', 'accept-language', 'content-type', 'range', 'if-none-match', 'if-modified-since', 'user-agent']

/**
 * Serves a sandbox port's web app at `/preview/<token>/<path>` (the token comes from `POST /api/preview`).
 * The token alone authorises: the app runs in a sandboxed (opaque-origin) frame, so it sends no cookies. The
 * request goes to Agentry's `/environments/{id}/ports/{port}/{path}` with the credential the token carries.
 */
async function handle(req: Request, ctx: { params: Promise<{ token: string; path?: string[] }> }): Promise<Response> {
  const { token, path = [] } = await ctx.params
  const grant = await verifyPreviewToken(token)
  if (!grant) return plain(404, 'This preview link has expired. Reopen the Preview tab.')
  const url = new URL(req.url)
  const segments = path.map((s) => encodeURIComponent(s)).join('/')
  const upstreamPath = `/agents/environments/${encodeURIComponent(grant.environment)}/ports/${String(grant.port)}${segments ? `/${segments}` : '/'}`
  // A trailing slash on the request is part of the app's path (`/dir/` differs from `/dir`).
  const trailing = segments && url.pathname.endsWith('/') ? '/' : ''
  const extra: Record<string, string> = {}
  for (const name of FORWARD) {
    const v = req.headers.get(name)
    if (v) extra[name] = v
  }
  const hasBody = req.method === 'POST'
  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(`${upstreamPath}${trailing}`, url.search), {
      method: req.method,
      headers: agentryHeaders(grant.authorization, extra),
      ...(hasBody ? { body: req.body, duplex: 'half' } : {}),
      redirect: 'manual',
      signal: req.signal,
      cache: 'no-store',
    } as RequestInit)
  } catch (error) {
    if (req.signal.aborted) throw error
    return plain(502, 'The sandbox could not be reached.')
  }
  if (upstream.status === 401) {
    await upstream.body?.cancel()
    return plain(401, 'Your sign-in expired. Reload the chat and reopen the Preview tab.')
  }
  return new Response(upstream.body, { status: upstream.status, headers: previewHeaders(upstream.headers, `/preview/${token}`) })
}

export const GET = handle
export const POST = handle
