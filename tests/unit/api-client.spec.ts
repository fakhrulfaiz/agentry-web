// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, isSignedOut, mergeMetadata, SETTING_NOT_LIVE, titleFrom } from '@/api/client'

const fetchMock = vi.fn<typeof fetch>()
const CSRF = 'meta-token'

beforeEach(() => {
  document.head.innerHTML = `<meta name="agentry-csrf" content="${CSRF}">`
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), method: init?.method, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

describe('api client', () => {
  it('sends the CSRF token from the meta tag and calls the BFF paths', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 's1', status: 'in_progress' }))
    await api.createSession({ text: '  Plan   a trip\nto Penang ', model: 'm1' })
    expect(lastCall()).toMatchObject({
      url: '/api/agentry/agents/sessions',
      method: 'POST',
      body: { agent: { model: 'm1' }, input: '  Plan   a trip\nto Penang ', metadata: { title: 'Plan a trip to Penang' } },
    })
    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)
    expect(lastCall().headers.get('authorization')).toBeNull()

    fetchMock.mockResolvedValueOnce(Response.json({ id: 's2', status: 'in_progress' }))
    await api.createSession({ text: 'Think hard', model: 'm1', effort: 'high' })
    expect(lastCall().body).toMatchObject({ agent: { model: 'm1', reasoning: { effort: 'high' } } })

    fetchMock.mockResolvedValueOnce(Response.json({ id: 's3', status: 'in_progress' }))
    await api.createSession({ text: 'Use my box', model: 'm1', environmentId: 'env_1' })
    expect(lastCall().body).toMatchObject({ environment: { type: 'sandbox', environment_id: 'env_1' } })

    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }))
    await api.listSessions({ after: 's9', limit: 20 })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions?after=s9&limit=20', method: 'GET' })

    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await api.deleteSession('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1', method: 'DELETE' })
  })

  it('calls the schedule routes through the BFF with the CSRF token', async () => {
    const timing = { kind: 'daily' as const, daily: { time: '09:00:00.000', time_zone: 'UTC' } }
    const schedule = {
      id: 's1',
      object: 'agent.schedule' as const,
      title: 'T',
      prompt: 'P',
      timing,
      status: 'active' as const,
      next_run_at: null,
      created_at: 'c',
      updated_at: 'u',
      revision: 'r1',
      session_id: 'sesn_1',
      running: false,
      last_run: null,
    }
    fetchMock.mockImplementation(async () => Response.json(schedule))

    await api.listSchedules({ status: 'active', limit: 20 })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules?status=active&limit=20', method: 'GET' })

    await api.createSchedule({ title: 'T', prompt: 'P', timing, agent: { model: 'm1' } })
    expect(lastCall()).toMatchObject({
      url: '/api/agentry/agents/schedules',
      method: 'POST',
      body: { title: 'T', prompt: 'P', timing, agent: { model: 'm1' } },
    })

    await api.getSchedule('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1', method: 'GET' })

    await api.updateSchedule('s1', { title: 'U', revision: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1', method: 'POST', body: { title: 'U', revision: 'r1' } })

    fetchMock.mockResolvedValue(Response.json({ id: 's1', object: 'agent.schedule.deleted', deleted: true }))
    await api.deleteSchedule('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1', method: 'DELETE' })

    fetchMock.mockImplementation(async () => Response.json(schedule))
    await api.pauseSchedule('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1/pause', method: 'POST' })
    await api.resumeSchedule('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1/resume', method: 'POST' })
    await api.runSchedule('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1/run', method: 'POST' })

    fetchMock.mockImplementation(async () => Response.json({ object: 'list', data: [], has_more: false, next_before: null }))
    await api.listScheduleRuns('s1', { limit: 10, before: 'b' })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/schedules/s1/runs?limit=10&before=b', method: 'GET' })

    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)
    expect(lastCall().headers.get('authorization')).toBeNull()
  })

  it('maps a schedule conflict to a 409 ApiError', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'schedule_conflict', message: 'The task changed elsewhere.' } }, { status: 409 }))
    await expect(api.updateSchedule('s1', { title: 'U', revision: 'old' })).rejects.toMatchObject({
      status: 409,
      code: 'schedule_conflict',
      message: 'The task changed elsewhere.',
    })
  })

  it('rename merges only the title and returns the saved map', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's1', metadata: { title: 'New', pinned: '1' } }))
    expect(await api.renameSession('s1', 'New')).toEqual({ title: 'New', pinned: '1' })
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1', method: 'POST', body: { metadata_merge: { title: 'New' } } })
  })

  it('mergeMetadata sets string keys, removes null ones, and keeps the rest', () => {
    expect(mergeMetadata({ title: 'T', starred: 'true', x: '1' }, { starred: null, title: 'U' })).toEqual({ title: 'U', x: '1' })
    expect(mergeMetadata(null, { starred: 'true' })).toEqual({ starred: 'true' })
    expect(mergeMetadata(undefined, { starred: null })).toEqual({})
    const current = { title: 'T' }
    mergeMetadata(current, { starred: 'true' })
    expect(current).toEqual({ title: 'T' })
  })

  it('star and unstar send metadata_merge (atomic on the server) and return the saved map', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's1', metadata: { title: 'Plan', pinned: '1', starred: 'true' } }))
    expect(await api.setStarred('s1', true)).toEqual({ title: 'Plan', pinned: '1', starred: 'true' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1', method: 'POST', body: { metadata_merge: { starred: 'true' } } })
    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)

    fetchMock.mockResolvedValueOnce(Response.json({ id: 's1', metadata: { title: 'Plan' } }))
    expect(await api.setStarred('s1', false)).toEqual({ title: 'Plan' })
    expect(lastCall().body).toEqual({ metadata_merge: { starred: null } })
  })

  it('listSessions sends a metadata filter as metadata[key]=value', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }))
    await api.listSessions({ limit: 100, metadata: { starred: 'true' } })
    expect(decodeURIComponent(lastCall().url)).toBe('/api/agentry/agents/sessions?limit=100&metadata[starred]=true')
  })

  it('items follows has_more pages', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'i1' }], first_id: 'i1', last_id: 'i1', has_more: true }))
    fetchMock.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'i2' }], first_id: 'i2', last_id: 'i2', has_more: false }))
    const items = await api.items('s1')
    expect(items.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/agentry/agents/sessions/s1/items?limit=100&after=i1')
  })

  it('a follow-up carries only the changed model and effort, as top-level fields of the message event', async () => {
    const message = { type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: 'go on' }] }] }
    fetchMock.mockImplementation(async () => Response.json({}))
    await api.sendMessage('s1', 'go on')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1/events', method: 'POST' })
    expect(lastCall().body).toEqual({ events: [message] })

    await api.sendMessage('s1', 'go on', { effort: 'high' })
    expect(lastCall().body).toEqual({ events: [{ ...message, reasoning: { effort: 'high' } }] })

    await api.sendMessage('s1', 'go on', { model: 'm2' })
    expect(lastCall().body).toEqual({ events: [{ ...message, model: 'm2' }] })

    await api.sendMessage('s1', 'go on', { effort: null })
    expect(lastCall().body).toEqual({ events: [{ ...message, reasoning: { effort: null } }] })

    await api.sendMessage('s1', 'go on', { model: 'm2', effort: 'low' })
    expect(lastCall().body).toEqual({ events: [{ ...message, model: 'm2', reasoning: { effort: 'low' } }] })
  })

  it('a refused setting change is a 409 ApiError with session_setting_not_live', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { type: 'invalid_request_error', message: 'reasoning effort "high" is not supported', code: 'session_setting_not_live' } }, { status: 409 }),
    )
    await expect(api.sendMessage('s1', 'hi', { effort: 'high' })).rejects.toMatchObject({
      status: 409,
      code: SETTING_NOT_LIVE,
      message: 'reasoning effort "high" is not supported',
    })
  })

  it('throws ApiError with the Agentry error code and message', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { type: 'server_error', message: 'agents store unavailable', code: 'store_unavailable' } }, { status: 503 }))
    const error = await api.sendMessage('s1', 'hi').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 503, code: 'store_unavailable', message: 'agents store unavailable' })
    expect(isSignedOut(error)).toBe(false)
  })

  it('maps the BFF signed_out answer to a 401 ApiError', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'signed_out' }, { status: 401 }))
    const error = await api.models().catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 401, code: 'signed_out' })
    expect(isSignedOut(error)).toBe(true)
    expect(lastCall().url).toBe('/api/models')
  })

  it('listSkills reads GET /api/agentry/agents/skills', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [{ name: 'plan' }] }))
    await expect(api.listSkills()).resolves.toEqual({ object: 'list', data: [{ name: 'plan' }] })
    expect(lastCall().url).toBe('/api/agentry/agents/skills')
    expect(lastCall().method).toBe('GET')
  })

  it('listSkills and listCommands pass the chat as session_id', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ object: 'list', data: [] })))
    await api.listSkills('s 1')
    expect(lastCall().url).toBe('/api/agentry/agents/skills?session_id=s%201')
    await api.listCommands('s1')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/commands?session_id=s1', method: 'GET' })
    await api.listCommands()
    expect(lastCall().url).toBe('/api/agentry/agents/commands')
  })

  it('runCommand posts the input to the chat command route', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ command_id: 'c1', name: 'goal', status: 'success' })))
    await api.runCommand('s1', 'goal', 'ship it')
    expect(lastCall()).toMatchObject({ url: '/api/agentry/agents/sessions/s1/commands/goal', method: 'POST', body: { input: 'ship it' } })
    await api.runCommand('s1', 'compact')
    expect(lastCall().body).toEqual({})
  })

  it('a busy chat rejects runCommand with the session_busy code', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'session_busy', message: 'busy' } }, { status: 409 }))
    await expect(api.runCommand('s1', 'compact')).rejects.toMatchObject({ status: 409, code: 'session_busy' })
  })

  it('listSessionArtifacts reads GET /api/agentry/agents/sessions/{id}/artifacts', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [] }))
    await api.listSessionArtifacts('sesn_1')
    expect(lastCall().url).toBe('/api/agentry/agents/sessions/sesn_1/artifacts')
    expect(lastCall().method).toBe('GET')
  })

  it('listSessionDeliverables reads GET /api/agentry/agents/sessions/{id}/deliverables', async () => {
    fetchMock.mockResolvedValue(Response.json({ object: 'list', data: [] }))
    await api.listSessionDeliverables('sesn_1')
    expect(lastCall().url).toBe('/api/agentry/agents/sessions/sesn_1/deliverables')
    expect(lastCall().method).toBe('GET')
  })

  it('a network failure is an ApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.cancel('s1')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('logout returns redirectTo, and /login when the session is already gone', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ redirectTo: 'https://kc.test/logout?client_id=agentry-web' }))
    expect(await api.logout()).toBe('https://kc.test/logout?client_id=agentry-web')
    expect(lastCall()).toMatchObject({ url: '/api/auth/logout', method: 'POST' })
    expect(lastCall().headers.get('x-agentry-csrf')).toBe(CSRF)

    fetchMock.mockResolvedValueOnce(Response.json({ error: 'forbidden' }, { status: 403 }))
    expect(await api.logout()).toBe('/login')
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'signed_out' }, { status: 401 }))
    expect(await api.logout()).toBe('/login')
  })

  it('titleFrom truncates long first messages', () => {
    expect(titleFrom('x'.repeat(100))).toHaveLength(80)
    expect(titleFrom('x'.repeat(100)).endsWith('…')).toBe(true)
  })
})
