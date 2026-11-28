import { jsonError } from '@/server/agentry'
import { ID_SEGMENT } from '@/server/allowlist'
import { checkCsrf } from '@/server/csrf'
import { mintPreviewToken, PREVIEW_TTL_MS } from '@/server/preview-token'
import { authFailure, requireCredential } from '@/server/require-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mints the token for a sandbox port preview: `{ environment, port }` in, `{ url, expires_at }` out, where `url`
 * is the base the preview is served from (`/preview/<token>/`). Same-origin and CSRF-checked like every
 * state-changing call. A Keycloak credential's token never outlives its access token.
 */
export async function POST(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try {
    auth = await requireCredential()
  } catch (error) {
    return authFailure(error)
  }
  if (!checkCsrf(req, auth.session)) return jsonError(403, 'forbidden')
  let body: { environment?: unknown; port?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return jsonError(400, 'invalid_request')
  }
  const { environment, port } = body
  if (typeof environment !== 'string' || !ID_SEGMENT.test(environment) || !environment.startsWith('env_')) return jsonError(400, 'invalid_request')
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return jsonError(400, 'invalid_request')
  const credential = auth.session.credential
  const ttl = credential?.kind === 'keycloak' ? Math.max(0, Math.min(PREVIEW_TTL_MS, credential.expiresAt - Date.now() - 15_000)) : PREVIEW_TTL_MS
  if (ttl < 15_000) return jsonError(503, 'auth_unavailable')
  const { token, exp } = await mintPreviewToken({ authorization: auth.authorization, environment, port }, ttl)
  return Response.json({ url: `/preview/${token}/`, expires_at: exp }, { headers: { 'cache-control': 'no-store' } })
}
