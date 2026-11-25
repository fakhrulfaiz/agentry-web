import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectedSlugs, loadInventory, parseAccounts } from '@/server/connector-inventory'

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

describe('loadInventory', () => {
  it('reads accounts per app and lists the connected slugs', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...listResult({ gmail: { accounts: [{ id: 'ca_1', status: 'active' }] }, slack: { accounts: [] } }) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } })))
    const result = await loadInventory('ck_x', ['gmail', 'slack'])
    expect(result.ok && connectedSlugs(result.inventory)).toEqual(['gmail'])
  })
  it('says why when the key is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    expect(await loadInventory('ck_bad', ['gmail'])).toEqual({ ok: false, reason: 'rejected' })
  })
})
