import { describe, expect, it } from 'vitest'
import { isAllowed } from '@/server/allowlist'

const ID = 'sesn_01HZX-abc_9'

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
