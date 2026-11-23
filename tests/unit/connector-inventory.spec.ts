import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectedAccounts, parseAccounts } from '@/server/connector-inventory'

const listResult = (results: Record<string, unknown>) => ({ result: { content: [{ text: JSON.stringify({ successful: true, data: { results } }) }] } })

afterEach(() => { vi.unstubAllGlobals() })

describe('parseAccounts', () => {
  it('maps each app to its accounts and whether one is active', () => {
    const parsed = parseAccounts(listResult({
      gmail: { accounts: [{ id: 'ca_1', alias: 'work', status: 'active' }, { id: 'ca_2', status: 'expired' }] },
      slack: { accounts: [] },
    }))
    expect(parsed).toEqual({
      gmail: { connected: true, accounts: [{ id: 'ca_1', alias: 'work', status: 'active' }, { id: 'ca_2', alias: null, status: 'expired' }] },
      slack: { connected: false, accounts: [] },
    })
  })
  it('throws on a failed call', () => {
    expect(() => parseAccounts({ error: { message: 'x' } })).toThrow()
  })
})

describe('connectedAccounts', () => {
  it('caches per owner for 60 seconds', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...listResult({ gmail: { accounts: [{ id: 'ca_1', status: 'active' }] } }) })
    const fetchMock = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await connectedAccounts('owner-a', 'ck_x', ['gmail'], 1_000)
    const calls = fetchMock.mock.calls.length
    const second = await connectedAccounts('owner-a', 'ck_x', ['gmail'], 30_000)
    expect(second).toEqual(first)
    expect(fetchMock.mock.calls.length).toBe(calls)
    await connectedAccounts('owner-a', 'ck_x', ['gmail'], 70_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls)
  })
})
