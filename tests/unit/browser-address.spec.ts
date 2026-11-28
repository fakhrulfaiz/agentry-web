import { describe, expect, it } from 'vitest'
import { parseAddress } from '@/ui/preview/browser-address'

describe('parseAddress', () => {
  it('splits a secure web URL into host and rest', () => {
    expect(parseAddress('https://example.com/a/b?q=1#top')).toEqual({ host: 'example.com', rest: '/a/b?q=1#top', href: 'https://example.com/a/b?q=1#top', isSecure: true })
  })
  it('keeps a port and marks plain http as not secure', () => {
    expect(parseAddress('http://localhost:3000/')).toEqual({ host: 'localhost:3000', rest: '', href: 'http://localhost:3000/', isSecure: false })
  })
  it('does not link non-web addresses', () => {
    expect(parseAddress('about:blank')).toEqual({ host: 'about:blank', rest: '', href: null, isSecure: false })
  })
})
