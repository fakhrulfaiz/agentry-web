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

  it('lists every snapshot, builds the download link and uploads the raw file with the CSRF header', async () => {
    await api.listAllEnvironmentSnapshots()
    expect(lastCall()).toMatchObject({ path: '/api/agentry/agents/environments/snapshots', method: 'GET' })
    expect(api.snapshotDownloadUrl('snap_x')).toBe('/api/agentry/agents/environments/snapshots/snap_x/content')

    const sent: { method: string; url: string; headers: Record<string, string>; body: unknown } = { method: '', url: '', headers: {}, body: undefined }
    class FakeXhr {
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
      status = 201
      responseText = JSON.stringify({ id: 'snap_new', object: 'snapshot' })
      onload?: () => void
      onerror?: () => void
      onabort?: () => void
      open(method: string, url: string) { sent.method = method; sent.url = url }
      setRequestHeader(k: string, v: string) { sent.headers[k] = v }
      abort() { this.onabort?.() }
      send(body: unknown) { sent.body = body; this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); this.onload?.() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const file = new File(['abc'], 'a.tar.gz')
    const progress = vi.fn()
    const snap = await api.importEnvironmentSnapshot(file, { name: 'My files', onProgress: progress })
    expect(snap).toMatchObject({ id: 'snap_new' })
    expect(sent).toMatchObject({ method: 'POST', url: '/api/agentry/agents/environments/snapshots/import?name=My%20files', body: file })
    expect(sent.headers['x-agentry-csrf']).toBe('tok')
    expect(progress).toHaveBeenCalledWith(0.5)
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
