/**
 * Headers every preview response carries. `sandbox` without `allow-same-origin` gives the page an opaque origin,
 * also when opened in its own tab, so the agent's app cannot read the Agentry app, its cookies or its CSRF token.
 * Only this origin may frame it.
 */
export const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'"

/** Response headers copied from the app's answer; everything else (notably `Set-Cookie`) is dropped. */
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-disposition']

/**
 * The headers for a preview response built from the app's own.
 * @param base - `/preview/<token>`, so an absolute-path redirect stays inside the preview.
 */
export function previewHeaders(upstream: Headers, base: string): Headers {
  const out = new Headers()
  for (const name of PASS) {
    const v = upstream.get(name)
    if (v) out.set(name, v)
  }
  const location = upstream.get('location')
  if (location) out.set('location', location.startsWith('/') && !location.startsWith('//') ? `${base}${location}` : location)
  out.set('content-security-policy', PREVIEW_CSP)
  out.set('x-content-type-options', 'nosniff')
  out.set('referrer-policy', 'no-referrer')
  out.set('x-frame-options', 'SAMEORIGIN')
  out.set('cache-control', 'no-store')
  return out
}
