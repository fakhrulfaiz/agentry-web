import { describe, expect, it, vi } from 'vitest'
import { createKeyedStore, REFRESH_MS } from '@/commands/list-store'

describe('createKeyedStore invalidate', () => {
  it('refetches every loaded key at once, ignoring the refresh throttle', async () => {
    const fetchList = vi.fn(async (key: string | undefined) => [key ?? 'none'])
    const store = createKeyedStore(fetchList)
    await store.refresh('', 1_000)
    await store.refresh('sess_1', 1_000)
    await store.refresh('sess_1', 1_000 + REFRESH_MS / 2)
    expect(fetchList).toHaveBeenCalledTimes(2)
    await store.invalidate()
    expect(fetchList).toHaveBeenCalledTimes(4)
    expect(fetchList.mock.calls.slice(2).map((c) => c[0])).toEqual([undefined, 'sess_1'])
  })
})
