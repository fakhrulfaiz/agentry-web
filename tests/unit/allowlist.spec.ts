import { describe, expect, it } from 'vitest'
import { isAllowed } from '@/server/allowlist'

const ID = 'sesn_01HZX-abc_9'
const SCHEDULE = 'sched_01HZX-abc_9'
/** Subagent ids are Host session UUIDs. */
const SUB = '7a75cb0f-e29e-45e7-8c42-fbed08549897'
const SUBAGENT_ROUTES = [
  `/agents/sessions/${ID}/subagents`,
  `/agents/sessions/${ID}/subagents/${SUB}`,
  `/agents/sessions/${ID}/subagents/${SUB}/items`,
  `/agents/sessions/${ID}/subagents/${SUB}/turns`,
]

describe('isAllowed', () => {
  it.each([
    ['GET', '/agents'],
    ['GET', '/agents/agent_123'],
    ['GET', '/agents/tools'],
    ['POST', '/agents/sessions'],
    ['GET', '/agents/sessions'],
    ['GET', `/agents/sessions/${ID}`],
    ['POST', `/agents/sessions/${ID}`],
    ['DELETE', `/agents/sessions/${ID}`],
    ['POST', `/agents/sessions/${ID}/events`],
    ['GET', `/agents/sessions/${ID}/items`],
    ['GET', `/agents/sessions/${ID}/turns`],
    ['GET', '/agents/skills'],
    ['POST', '/agents/files'],
    ['GET', '/agents/files/file_abc/content'],
    ['DELETE', '/agents/files/file_abc'],
    ['GET', '/agents/commands'],
    ['POST', `/agents/sessions/${ID}/commands/compact`],
    ['GET', `/agents/sessions/${ID}/artifacts`],
    ['GET', '/agents/schedules'],
    ['POST', '/agents/schedules'],
    ['GET', `/agents/schedules/${SCHEDULE}`],
    ['POST', `/agents/schedules/${SCHEDULE}`],
    ['DELETE', `/agents/schedules/${SCHEDULE}`],
    ['POST', `/agents/schedules/${SCHEDULE}/pause`],
    ['POST', `/agents/schedules/${SCHEDULE}/resume`],
    ['POST', `/agents/schedules/${SCHEDULE}/run`],
    ['GET', `/agents/schedules/${SCHEDULE}/runs`],
  ])('allows %s %s', (method, path) => {
    expect(isAllowed(method, path)).toBe(true)
  })

  it('accepts a lowercase method and a trailing slash', () => {
    expect(isAllowed('get', '/agents/')).toBe(true)
  })

  it('rejects traversal and non-allow-listed paths', () => {
    for (const path of [
      '/v1/agents/../admin',
      '/agents/../admin',
      '/agents/sessions/../../admin',
      '/agents/./sessions',
      '/agents/sessions/a%2Fb',
      '/agents/sessions/a%2fb/events',
      '/agents%2Fsessions',
      '/agents/sessions/%2e%2e',
      '/admin/v1/sessions',
      '/v1/agents',
      'http://evil/x',
      '//evil/x',
      'agents',
      '',
      '/agents//sessions',
      '/agents\\sessions',
      '/agents/sessions?x=1',
      '/agents/environments',
      '/agents/sessions/x/events/extra',
    ]) {
      expect(isAllowed('GET', path), path).toBe(false)
      expect(isAllowed('POST', path), path).toBe(false)
    }
  })

  it('never treats a reserved name as an agent id', () => {
    expect(isAllowed('GET', '/agents/environments')).toBe(false)
    // These resolve to their own routes (session list, tools list), not GET /agents/{id}.
    expect(isAllowed('GET', '/agents/sessions')).toBe(true)
    expect(isAllowed('GET', '/agents/tools')).toBe(true)
    expect(isAllowed('POST', '/agents/tools')).toBe(false)
  })

  it.each(SUBAGENT_ROUTES)('allows GET %s (subagent activity) and no other method', (path) => {
    expect(isAllowed('GET', path)).toBe(true)
    for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) expect(isAllowed(method, path)).toBe(false)
  })

  it('rejects traversal and bad ids on the subagent routes', () => {
    for (const path of [
      `/agents/sessions/${ID}/subagents/..`,
      `/agents/sessions/${ID}/subagents/../items`,
      `/agents/sessions/${ID}/subagents/%2e%2e/items`,
      `/agents/sessions/${ID}/subagents/a%2Fb/items`,
      `/agents/sessions/${ID}/subagents/${SUB}/events`,
      `/agents/sessions/${ID}/subagents/${SUB}/turns/turn_1`,
      `/agents/sessions/${ID}/subagents/${SUB}/turns/turn_1/items`,
      `/agents/sessions/${ID}/subagents/${SUB}/items/extra`,
      `/agents/sessions/../subagents/${SUB}`,
      `/agents/sessions/${ID}/subagents//items`,
    ]) {
      expect(isAllowed('GET', path), path).toBe(false)
    }
  })

  it('serves session artifacts only through the list rule (bytes have their own validated route)', () => {
    expect(isAllowed('GET', `/agents/sessions/${ID}/artifacts`)).toBe(true)
    expect(isAllowed('POST', `/agents/sessions/${ID}/artifacts`)).toBe(false)
    for (const path of [
      `/agents/sessions/${ID}/artifacts/report.docx`,
      `/agents/sessions/${ID}/artifacts/a/b/notes.md`,
      '/agents/artifacts',
      '/agents/artifacts/art_1/content',
    ]) {
      expect(isAllowed('GET', path), path).toBe(false)
    }
  })

  it('treats schedules as a reserved collection, never an agent id', () => {    expect(isAllowed('GET', '/agents/schedules')).toBe(true)
    expect(isAllowed('POST', '/agents/schedules')).toBe(true)
    expect(isAllowed('DELETE', '/agents/schedules')).toBe(false)
  })

  it('rejects other methods, traversal and bad ids on the schedule routes', () => {
    for (const path of [
      `/agents/schedules/${SCHEDULE}/other`,
      `/agents/schedules/${SCHEDULE}/pause/extra`,
      `/agents/schedules/a%2Fb`,
      '/agents/schedules/..',
      '/agents/schedules/../run',
      '/agents/schedules//runs',
    ]) {
      expect(isAllowed('GET', path), path).toBe(false)
      expect(isAllowed('POST', path), path).toBe(false)
    }
    expect(isAllowed('GET', `/agents/schedules/${SCHEDULE}/pause`)).toBe(false)
    expect(isAllowed('POST', `/agents/schedules/${SCHEDULE}/runs`)).toBe(false)
    expect(isAllowed('DELETE', `/agents/schedules/${SCHEDULE}/run`)).toBe(false)
  })

  it('rejects methods outside the allow-list', () => {
    expect(isAllowed('DELETE', '/agents/agent_1')).toBe(false)
    expect(isAllowed('POST', '/agents')).toBe(false)
    expect(isAllowed('PUT', `/agents/sessions/${ID}`)).toBe(false)
    expect(isAllowed('PATCH', `/agents/sessions/${ID}`)).toBe(false)
    expect(isAllowed('GET', `/agents/sessions/${ID}/events`)).toBe(false)
    expect(isAllowed('DELETE', '/agents/sessions')).toBe(false)
    expect(isAllowed('TRACE', '/agents')).toBe(false)
    expect(isAllowed('', '/agents')).toBe(false)
  })
})
