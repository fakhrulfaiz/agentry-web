/** The parts of a page address the Browser tab shows in its toolbar. */
export interface BrowserAddress {
  host: string
  rest: string
  /** The original URL, only when it is safe to open in a new tab. */
  href: string | null
  isSecure: boolean
}

/**
 * Splits a web address into a host and the path/query/hash after it. Non-web addresses
 * (`about:blank`, `data:`, malformed URLs) stay readable text and are never linked.
 */
export function parseAddress(url: string): BrowserAddress {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        host: parsed.host,
        rest: `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`,
        href: url,
        isSecure: parsed.protocol === 'https:',
      }
    }
  } catch {
    // Not a URL: fall through to the plain-text shape.
  }
  return { host: url, rest: '', href: null, isSecure: false }
}
