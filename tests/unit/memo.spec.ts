import { describe, expect, it, vi } from 'vitest'
import { memoize } from '@/api/memo'

describe('memoize', () => {
  it('answers from the cache until the time to live passes', async () => {
    let now = 0
    const load = vi.fn(async () => now)
    const memo = memoize(load, 1000, () => now)
    expect(await memo.get()).toBe(0)
    now = 999
    expect(await memo.get()).toBe(0)
    now = 1000
    expect(await memo.get()).toBe(1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one request between callers that ask at the same time', async () => {
    const load = vi.fn(async () => 'x')
    const memo = memoize(load, 1000)
    await Promise.all([memo.get(), memo.get()])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok')
    const memo = memoize(load, 1000)
    await expect(memo.get()).rejects.toThrow('down')
    expect(await memo.get()).toBe('ok')
  })

  it('reloads after clear', async () => {
    const load = vi.fn(async () => 'x')
    const memo = memoize(load, 1000)
    await memo.get()
    memo.clear()
    await memo.get()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
