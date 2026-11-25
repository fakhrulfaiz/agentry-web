// Shared test doubles for `next/headers` cookies and `@/config/env`.
import type { WebConfig } from '@/config/env'

export interface SetCall {
  name: string
  value: string
  options: Record<string, unknown>
}

/** A `cookies()`-shaped store that records every write. */
export class FakeCookieStore {
  readonly jar = new Map<string, string>()
  readonly writes: SetCall[] = []

  get(name: string) {
    const value = this.jar.get(name)
    return value === undefined ? undefined : { name, value }
  }

  getAll() {
    return [...this.jar].map(([name, value]) => ({ name, value }))
  }

  has(name: string) {
    return this.jar.has(name)
  }

  set(name: string, value: string, options: Record<string, unknown> = {}) {
    this.writes.push({ name, value, options })
    if (options.maxAge === 0) this.jar.delete(name)
    else this.jar.set(name, value)
    return this
  }

  delete(name: string) {
    this.writes.push({ name, value: '', options: { maxAge: 0 } })
    this.jar.delete(name)
    return this
  }

  /** Cookie header a browser would send back. */
  header(): string {
    return [...this.jar].map(([n, v]) => `${n}=${v}`).join('; ')
  }

  /** Fresh store carrying the same cookies (a following request). */
  next(): FakeCookieStore {
    const store = new FakeCookieStore()
    for (const [n, v] of this.jar) store.jar.set(n, v)
    return store
  }
}

export const SECRET = 'test-secret-that-is-at-least-32-bytes-long!!'

export function testConfig(overrides: Partial<WebConfig> = {}): WebConfig {
  return {
    auth: 'apikey',
    apiUrl: 'http://agentry.test',
    sessionSecret: SECRET,
    models: [],
    production: false,
    cookieSecure: 'auto',
    ...overrides,
  }
}

/** Mutable state the `vi.mock` factories read from. */
export const mockState: { store: FakeCookieStore; config: WebConfig; headers: Headers } = {
  store: new FakeCookieStore(),
  config: testConfig(),
  /** The request headers `next/headers` `headers()` returns. */
  headers: new Headers(),
}

export function sameOriginRequest(url: string, init: RequestInit & { csrf?: string } = {}): Request {
  const headers = new Headers(init.headers)
  const u = new URL(url)
  headers.set('host', u.host)
  if (!headers.has('origin')) headers.set('origin', u.origin)
  if (init.csrf) headers.set('x-agentry-csrf', init.csrf)
  return new Request(url, { ...init, headers })
}
