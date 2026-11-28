// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  document.head.innerHTML = '<meta name="agentry-csrf" content="tok">'
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  const u = new URL(String(url), 'http://web.test')
  return { path: u.pathname, search: u.search, method: init?.method, csrf: new Headers(init?.headers).get('x-agentry-csrf'), body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

describe('snapshot api client', () => {
  it('saves with only the fields given, and sends the CSRF header', async () => {
    await api.saveEnvironmentSnapshot('env_1', { name: 'Nightly', level: 'disk', stopFirst: true })
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/env_1/snapshots', method: 'POST', csrf: 'tok', body: { name: 'Nightly', level: 'disk', stop_first: true } })
    await api.saveEnvironmentSnapshot('env_1')
    expect(lastCall().body).toEqual({})
  })

  it('lists, restores and deletes a snapshot', async () => {
    await api.listEnvironmentSnapshots('env_1')
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/env_1/snapshots', method: 'GET' })
    await api.restoreEnvironmentSnapshot('env_1', 'snap_x')
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/env_1/restore', method: 'POST', csrf: 'tok', body: { snapshot_id: 'snap_x' } })
    await api.deleteEnvironmentSnapshot('snap_x')
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/snapshots/snap_x', method: 'DELETE', csrf: 'tok' })
  })

  it('creates from a snapshot and deletes an environment with or without its snapshots', async () => {
    await api.createSandboxEnvironment({ provider: 'sandbox', snapshotId: 'snap_x' })
    expect(lastCall().body).toEqual({ provider: 'sandbox', snapshot_id: 'snap_x' })
    await api.deleteSandboxEnvironment('env_1')
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/env_1', search: '', method: 'DELETE' })
    await api.deleteSandboxEnvironment('env_1', { deleteSnapshots: true })
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/env_1', search: '?delete_snapshots=true' })
  })
})
