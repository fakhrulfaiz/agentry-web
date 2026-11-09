import { describe, expect, it } from 'vitest'
import type { IronSession } from 'iron-session'
import { checkCsrf, ensureCsrf, isSameOrigin } from '@/server/csrf'
import type { SessionData } from '@/server/session'

const URL_ = 'http://web.test/api/agentry/agents/sessions'

function req(headers: Record<string, string>): Request {
  return new Request(URL_, { method: 'POST', headers: { host: 'web.test', ...headers } })
}

describe('ensureCsrf', () => {
  it('creates a 32-byte base64url token once', () => {
    const session = {} as IronSession<SessionData>
    const token = ensureCsrf(session)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(ensureCsrf(session)).toBe(token)
    expect(session.csrf).toBe(token)
  })
})

describe('checkCsrf', () => {
  const session: SessionData = { csrf: 'expected-token' }

  it('accepts a same-origin request with the matching header', () => {
    expect(checkCsrf(req({ origin: 'http://web.test', 'x-agentry-csrf': 'expected-token' }), session)).toBe(true)
  })

  it('is false for a missing header', () => {
    expect(checkCsrf(req({ origin: 'http://web.test' }), session)).toBe(false)
  })

  it('is false for a mismatched token', () => {
    expect(checkCsrf(req({ origin: 'http://web.test', 'x-agentry-csrf': 'expected-tokeX' }), session)).toBe(false)
    expect(checkCsrf(req({ origin: 'http://web.test', 'x-agentry-csrf': 'short' }), session)).toBe(false)
  })

  it('is false for a cross-origin Origin', () => {
    expect(checkCsrf(req({ origin: 'http://evil.test', 'x-agentry-csrf': 'expected-token' }), session)).toBe(false)
  })

  it('is false without an Origin or session token', () => {
    expect(checkCsrf(req({ 'x-agentry-csrf': 'expected-token' }), session)).toBe(false)
    expect(checkCsrf(req({ origin: 'http://web.test', 'x-agentry-csrf': 'expected-token' }), {} as SessionData)).toBe(false)
  })
})

describe('isSameOrigin', () => {
  it('compares the Origin host with the request host', () => {
    expect(isSameOrigin(req({ origin: 'http://web.test' }))).toBe(true)
    expect(isSameOrigin(req({ origin: 'null' }))).toBe(false)
    expect(isSameOrigin(req({ origin: 'http://web.test.evil.test' }))).toBe(false)
  })
})
