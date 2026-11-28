import { describe, expect, it } from 'vitest'
import type { OAIAgent } from '@/api/types'
import { agentToForm, emptyForm, formToParams, toolMask } from '@/agents/form'
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
    expect(params.metadata).toEqual({ owner_note: 'x', icon: expect.any(String), color: expect.any(String) })
    expect(params.apps).toEqual({ gmail: 'all', github: 'all' })
    expect(params.reasoning).toEqual({ effort: 'high' })
  })
  it('sends no mask when every tool is allowed, and clears connectors when none', () => {
    const form = { ...emptyForm('m1'), name: ' A ', allTools: false, tools: ['a', 'b'] }
    const params = formToParams(form, ['a', 'b'])
    expect(params.host_tools).toBeNull()
    expect(params.name).toBe('A')
    expect(params.metadata).toEqual({ icon: expect.any(String), color: expect.any(String) })
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
    expect(params.metadata).toEqual({ icon: expect.any(String), color: expect.any(String) })
    expect(formToParams({ ...emptyForm('m1'), name: 'B' })).toMatchObject({ apps: null, skills: null, send_policy: 'ask' })
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

describe('review fixes: tool masks', () => {
  it('keeps a saved deny list through edit and save (chat-created agents)', async () => {
    const { agentToForm: toForm, formToParams: toParams } = await import('@/agents/form')
    const form = toForm({ id: 'agent_1', object: 'agent', name: 'Made in chat', model: 'm1', host_tools: { deny: ['agent_create', 'agent_update'] } } as never)
    expect(form.allTools).toBe(true)
    expect(toParams({ ...form, color: 'teal' }, ['read', 'agent_create', 'agent_update']).host_tools).toEqual({ deny: ['agent_create', 'agent_update'] })
  })

  it('keeps the deny list next to a chosen allow list', async () => {
    const { agentToForm: toForm, formToParams: toParams } = await import('@/agents/form')
    const form = toForm({ id: 'agent_1', object: 'agent', name: 'X', model: 'm1', host_tools: { allow: ['read'], deny: ['agent_create'] } } as never)
    expect(toParams(form, ['read', 'write', 'agent_create']).host_tools).toEqual({ allow: ['read'], deny: ['agent_create'] })
  })
})

describe('browser field', () => {
  it('maps null/true/false to auto/on/off and back', () => {
    expect(agentToForm(agent({ metadata: {} })).browser).toBe('auto')
    expect(agentToForm(agent({ metadata: {}, browser: null })).browser).toBe('auto')
    const on = agentToForm(agent({ metadata: {}, browser: true }))
    expect(on.browser).toBe('on')
    expect(formToParams(on).browser).toBe(true)
    expect(formToParams({ ...on, browser: 'off' }).browser).toBe(false)
    expect(formToParams({ ...on, browser: 'auto' }).browser).toBeNull()
    expect(agentToForm(agent({ metadata: {}, browser: false })).browser).toBe('off')
    expect(emptyForm().browser).toBe('auto')
  })
})
