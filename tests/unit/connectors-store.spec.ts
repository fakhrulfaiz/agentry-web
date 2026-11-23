import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testConfig } from '../helpers/next-mocks'

vi.mock('@/config/env', () => ({ getConfig: () => testConfig() }))

const store = await import('@/server/connectors-store')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectors-'))
  process.env.AGENTRY_WEB_DATA_DIR = dir
})
afterEach(async () => {
  delete process.env.AGENTRY_WEB_DATA_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('connectors store', () => {
  it('round-trips a key per owner and does not store it in plain text', async () => {
    await store.setKey('alice', 'ck_test_123')
    await store.setKey('bob', 'ck_test_456')
    expect(await store.getKey('alice')).toBe('ck_test_123')
    expect(await store.getKey('bob')).toBe('ck_test_456')
    expect(await store.hasKey('alice')).toBe(true)
    expect(await store.hasKey('carol')).toBe(false)
    const raw = await readFile(path.join(dir, 'connectors.json'), 'utf8')
    expect(raw).not.toContain('ck_test_123')
    expect(raw).not.toContain('ck_test_456')
  })

  it('replaces and removes a key', async () => {
    await store.setKey('alice', 'ck_test_123')
    await store.setKey('alice', 'ck_test_789')
    expect(await store.getKey('alice')).toBe('ck_test_789')
    await store.removeKey('alice')
    expect(await store.getKey('alice')).toBeUndefined()
    expect(await store.hasKey('alice')).toBe(false)
    await store.removeKey('alice')
  })

  it.each(['', '   ', 'ck_', 'sk_test_123'])('rejects %j', async (bad) => {
    await expect(store.setKey('alice', bad)).rejects.toBeInstanceOf(store.InvalidConnectorKeyError)
    expect(await store.hasKey('alice')).toBe(false)
  })
})
