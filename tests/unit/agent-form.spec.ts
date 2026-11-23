import { describe, expect, it } from 'vitest'
import type { OAIAgent } from '@/api/types'
import { agentToForm, connectorNote, emptyForm, formToParams, instructionsWithConnectors, toolMask } from '@/agents/form'
import { STARTERS } from '@/agents/starters'

const agent = (over: Partial<OAIAgent> = {}): OAIAgent => ({
  id: 'agent_1', object: 'agent', created_at: 1, updated_at: 1, name: 'Reviewer', instructions: 'Review.', model: 'm1',
  metadata: { connectors: 'gmail,github', owner_note: 'x' }, tools: [], ...over,
})

describe('agent form', () => {
  it('round-trips a saved agent and keeps other metadata', () => {
    const form = agentToForm(agent({ host_tools: { allow: ['read_file'] }, multi_agent: { enabled: true, max_concurrent_subagents: 2 }, reasoning: { effort: 'high' } }))
    expect(form).toMatchObject({ allTools: false, tools: ['read_file'], apps: { gmail: 'all', github: 'all' }, subagents: true, maxSubagents: 2, effort: 'high', extraMetadata: { owner_note: 'x' } })
    const params = formToParams(form, ['read_file', 'write_file'])
    expect(params.host_tools).toEqual({ allow: ['read_file'] })
    expect(params.metadata).toEqual({ owner_note: 'x' })
    expect(params.apps).toEqual({ gmail: 'all', github: 'all' })
    expect(params.reasoning).toEqual({ effort: 'high' })
  })
  it('sends no mask when every tool is allowed, and clears connectors when none', () => {
    const form = { ...emptyForm('m1'), name: ' A ', allTools: false, tools: ['a', 'b'] }
    const params = formToParams(form, ['a', 'b'])
    expect(params.host_tools).toBeNull()
    expect(params.name).toBe('A')
    expect(params.metadata).toEqual({})
    expect(params.multi_agent).toEqual({ enabled: false })
  })
})

describe('skills, apps and sending', () => {
  it('reads saved grants, selection and policy; legacy connectors become all-tools grants', () => {
    const saved = agentToForm(agent({ metadata: {}, apps: { gmail: ['GMAIL_FETCH_EMAILS'] }, skills: { builtin: ['composio'], library: [] }, send_policy: 'auto' }))
    expect(saved).toMatchObject({ apps: { gmail: ['GMAIL_FETCH_EMAILS'] }, skills: { builtin: ['composio'], library: [] }, sendPolicy: 'auto' })
    expect(agentToForm(agent()).apps).toEqual({ gmail: 'all', github: 'all' })
    expect(agentToForm(agent({ metadata: {} }))).toMatchObject({ apps: null, skills: null, sendPolicy: 'ask' })
  })
  it('writes apps, skills and send_policy, never metadata.connectors', () => {
    const form = { ...emptyForm('m1'), name: 'A', apps: { gmail: 'all' as const }, skills: { builtin: ['create-agent'], library: ['skill_x'] }, sendPolicy: 'auto' as const }
    const params = formToParams(form)
    expect(params).toMatchObject({ apps: { gmail: 'all' }, skills: { builtin: ['create-agent'], library: ['skill_x'] }, send_policy: 'auto' })
    expect(params.metadata).toEqual({})
    expect(formToParams({ ...emptyForm('m1'), name: 'B' })).toMatchObject({ apps: null, skills: null, send_policy: 'ask' })
  })
})

describe('soft app limit', () => {
  it('appends the note to the saved instructions; nothing without connectors', () => {
    expect(instructionsWithConnectors('Review.', 'gmail,github')).toBe(`Review.\n\n${connectorNote(['gmail', 'github'])}`)
    expect(instructionsWithConnectors('Review.', undefined)).toBeUndefined()
    expect(instructionsWithConnectors(null, 'gmail')).toBe(connectorNote(['gmail']))
  })
})

describe('starters', () => {
  const catalog = ['read_file', 'grep', 'glob', 'write_file', 'shell', 'web_fetch']
  it('maps presets to catalog names and drops what the catalog lacks', () => {
    expect(toolMask('all', catalog)).toBeNull()
    expect(toolMask('read-only', catalog)).toEqual(['read_file', 'grep', 'glob', 'web_fetch'])
    expect(toolMask('edit', catalog)).toEqual(expect.arrayContaining(['read_file', 'write_file', 'shell']))
    expect(toolMask('read-only', ['unknown'])).toEqual([])
  })
  it('has unique ids and non-empty prompts', () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length)
    for (const s of STARTERS) expect(s.instructions.length).toBeGreaterThan(40)
  })
})
