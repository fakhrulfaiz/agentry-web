import 'server-only'

function first(value: string | null): string | undefined {
  const v = value?.split(',')[0]?.trim()
  return v ? v : undefined
}

/**
 * The origin the browser used, for absolute links back to this app (such as
 * Keycloak's `post_logout_redirect_uri`). Behind a reverse proxy this comes from
 * `X-Forwarded-Proto` / `X-Forwarded-Host` (first value of each); otherwise from
 * the request URL.
 */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url)
  const proto = first(req.headers.get('x-forwarded-proto'))?.toLowerCase()
  const host = first(req.headers.get('x-forwarded-host'))
  const protocol = proto === 'http' || proto === 'https' ? `${proto}:` : url.protocol
  if (!host) return `${protocol}//${url.host}`
  try {
    return new URL(`${protocol}//${host}`).origin
  } catch {
    return url.origin
  }
}
