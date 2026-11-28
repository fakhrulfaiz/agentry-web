import { describe, expect, it } from 'vitest'
import { connectedSlugs } from '@/server/connector-inventory'

describe('connectedSlugs', () => {
  it('lists the apps with an active account', () => {
    expect(connectedSlugs({ gmail: { connected: true, accounts: [] }, slack: { connected: false, accounts: [] } })).toEqual(['gmail'])
  })
})
