import { describe, expect, it } from 'vitest'
import { publicOrigin } from '@/server/origin'

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

describe('publicOrigin', () => {
  it('uses the request URL without forwarded headers', () => {
    expect(publicOrigin(req('http://localhost:3000/api/auth/logout'))).toBe('http://localhost:3000')
  })

  it('prefers X-Forwarded-Proto and X-Forwarded-Host (first value of each)', () => {
    const r = req('http://10.0.0.5:3000/x', {
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'chat.example.com, internal:3000',
    })
    expect(publicOrigin(r)).toBe('https://chat.example.com')
  })

  it('applies a forwarded proto alone to the request host', () => {
    expect(publicOrigin(req('http://chat.example.com/x', { 'x-forwarded-proto': 'https' }))).toBe('https://chat.example.com')
  })

  it('ignores an unknown proto and an unparsable host', () => {
    expect(publicOrigin(req('http://web.test/x', { 'x-forwarded-proto': 'javascript' }))).toBe('http://web.test')
    expect(publicOrigin(req('http://web.test/x', { 'x-forwarded-host': 'bad host/' }))).toBe('http://web.test')
  })
})
