// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'

const fetchMock = vi.fn<typeof fetch>()
const CSRF = 'meta-token'
const PAGE = { object: 'list' as const, data: [], first_id: null, last_id: null, has_more: false }

beforeEach(() => {
  document.head.innerHTML = `<meta name="agentry-csrf" content="${CSRF}">`
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return {
    url: String(url),
    path: new URL(String(url), 'http://web.test').pathname,
    query: new URL(String(url), 'http://web.test').searchParams,
    method: init?.method,
    headers: new Headers(init?.headers),
    credentials: init?.credentials,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }
}

function expectBff(call: ReturnType<typeof lastCall>) {
  expect(call.headers.get('x-agentry-csrf')).toBe(CSRF)
  expect(call.headers.get('authorization')).toBeNull()
  expect(call.credentials).toBe('same-origin')
}

describe('projects api client', () => {
  it('lists projects with status and paging params', async () => {
    fetchMock.mockResolvedValue(Response.json(PAGE))
    expect(await api.listProjects({ status: 'archived', after: 'p_0', limit: 10 })).toEqual(PAGE)
    const call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects')
    expect(call.method).toBe('GET')
    expect(call.query.get('status')).toBe('archived')
    expect(call.query.get('after')).toBe('p_0')
    expect(call.query.get('limit')).toBe('10')
    expectBff(call)
  })

  it('creates and deletes projects with csrf header', async () => {
    const project = {
      id: 'proj_1',
      object: 'project' as const,
      name: 'Trip',
      status: 'active' as const,
      pinned: true,
      agent_id: 'agent_1',
      environment: null,
      archived_at: null,
      created_at: 1,
      updated_at: 1,
    }
    fetchMock.mockImplementation(async () => Response.json(project))

    expect(await api.createProject({ name: 'Trip', pinned: true, agent_id: 'agent_1' })).toEqual(project)
    let call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ name: 'Trip', pinned: true, agent_id: 'agent_1' })
    expectBff(call)

    await api.getProject('proj_1')
    call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects/proj_1')
    expect(call.method).toBe('GET')
    expectBff(call)

    await api.updateProject('proj_1', { name: 'Renamed', pinned: false })
    call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects/proj_1')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ name: 'Renamed', pinned: false })
    expectBff(call)

    await api.archiveProject('proj_1')
    call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects/proj_1/archive')
    expect(call.method).toBe('POST')
    expectBff(call)

    await api.unarchiveProject('proj_1')
    call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects/proj_1/unarchive')
    expect(call.method).toBe('POST')
    expectBff(call)

    fetchMock.mockResolvedValue(Response.json({ id: 'proj_1', object: 'project.deleted', deleted: true }))
    expect(await api.deleteProject('proj_1')).toEqual({ id: 'proj_1', object: 'project.deleted', deleted: true })
    call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/projects/proj_1')
    expect(call.method).toBe('DELETE')
    expectBff(call)
  })

  it('lists sessions by projectId', async () => {
    fetchMock.mockResolvedValue(Response.json(PAGE))
    await api.listSessions({ projectId: 'proj_1', after: 's_0', limit: 20 })
    const call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/sessions')
    expect(call.query.get('project_id')).toBe('proj_1')
    expect(call.query.get('after')).toBe('s_0')
    expect(call.query.get('limit')).toBe('20')
    expectBff(call)
  })

  it('creates a session with projectId', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'sesn_1', project_id: 'proj_1' }))
    await api.createSession({ text: 'Plan a trip', model: 'm1', projectId: 'proj_1' })
    const call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/sessions')
    expect(call.method).toBe('POST')
    expect(call.body).toMatchObject({ project_id: 'proj_1', agent: { model: 'm1' }, input: 'Plan a trip' })
    expectBff(call)
  })

  it('moves a session to a project and to unfiled', async () => {
    fetchMock.mockImplementation(async () => Response.json({ id: 'sesn_1', project_id: null }))
    await api.setSessionProject('sesn_1', 'proj_1')
    let call = lastCall()
    expect(call.path).toBe('/api/agentry/agents/sessions/sesn_1')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ project_id: 'proj_1' })
    expectBff(call)

    await api.setSessionProject('sesn_1', null)
    call = lastCall()
    expect(call.body).toEqual({ project_id: null })
    expectBff(call)
  })
})
