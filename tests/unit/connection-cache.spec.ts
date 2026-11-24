import { describe, expect, it, vi } from 'vitest'
import { createConnectionCache, type LoadResult } from '@/server/connection-cache'

const ok = (slugs: string[]): LoadResult => ({ ok: true, inventory: Object.fromEntries(slugs.map((s) => [s, { connected: true, accounts: [] }])) })
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(results: LoadResult[]) {
  let now = 0
  const load = vi.fn(async () => results.shift() ?? ok([]))
  const cache = createConnectionCache({ load, now: () => now, freshMs: 60_000, staleMs: 3_600_000, failureMs: 30_000 })
  return { cache, load, at: (t: number) => { now = t } }
}

describe('connection cache', () => {
  it('loads once, then answers from memory while fresh', async () => {
    const { cache, load, at } = setup([ok(['gmail'])])
    expect((await cache.get('a', 'k', ['gmail'])).inventory?.gmail?.connected).toBe(true)
    at(59_000)
    const again = await cache.get('a', 'k', ['gmail'])
    expect(again.stale).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('answers a stale value at once and refreshes it in the background', async () => {
    const { cache, load, at } = setup([ok(['gmail']), ok(['github'])])
    await cache.get('a', 'k', ['gmail'])
    at(61_000)
    const stale = await cache.get('a', 'k', ['gmail'])
    expect(stale.stale).toBe(true)
    expect(stale.inventory?.gmail).toBeDefined()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.peek('a')?.inventory?.github).toBeDefined()
    expect(cache.peek('a')?.checkedAt).toBe(61_000)
  })

  it('shares one request between callers', async () => {
    const { cache, load } = setup([ok(['gmail'])])
    await Promise.all([cache.get('a', 'k', []), cache.get('a', 'k', [])])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('remembers a failure briefly so every page open does not wait on it', async () => {
    const { cache, load, at } = setup([{ ok: false, reason: 'rejected' }, ok(['gmail'])])
    expect(await cache.get('a', 'k', [])).toMatchObject({ inventory: null, problem: 'rejected' })
    at(29_000)
    expect((await cache.get('a', 'k', [])).problem).toBe('rejected')
    expect(load).toHaveBeenCalledTimes(1)
    at(31_000)
    expect((await cache.get('a', 'k', [])).inventory?.gmail).toBeDefined()
  })

  it('keeps the last good answer when a refresh fails', async () => {
    const { cache, at } = setup([ok(['gmail']), { ok: false, reason: 'unavailable' }])
    await cache.get('a', 'k', [])
    at(61_000)
    await cache.get('a', 'k', [])
    await flush()
    const snap = cache.peek('a')
    expect(snap?.inventory?.gmail).toBeDefined()
    expect(snap?.problem).toBe('unavailable')
  })

  it('forces a fresh check and forgets an owner', async () => {
    const { cache, load } = setup([ok(['gmail']), ok(['github']), ok([])])
    await cache.get('a', 'k', [])
    expect((await cache.get('a', 'k', [], { force: true })).inventory?.github).toBeDefined()
    cache.forget('a')
    expect(cache.peek('a')).toBeUndefined()
    await cache.get('a', 'k', [])
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not serve one key’s answer for another key', async () => {
    const { cache, load } = setup([ok(['gmail']), ok([])])
    await cache.get('a', 'k1', [])
    expect((await cache.get('a', 'k2', [])).inventory?.gmail).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
