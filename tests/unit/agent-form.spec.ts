import { describe, expect, it } from 'vitest'
import type { OAIAgent } from '@/api/types'
import { agentToForm, delegationError, descriptionError, emptyForm, formToParams } from '@/agents/form'

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
    expect(params.description).toBe('Review.')
    expect(params.delegation).toEqual({ mode: 'any', agent_ids: [] })
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

describe('description', () => {
  it('round-trips a saved one-line description', () => {
    const form = agentToForm(agent({ description: 'Reviews pull requests' }))
    expect(form.description).toBe('Reviews pull requests')
    expect(formToParams(form).description).toBe('Reviews pull requests')
  })

  it('falls back to legacy metadata, then the first instruction line, capped at the API limit', () => {
    expect(agentToForm(agent({ metadata: { description: 'Sorts the inbox' }, instructions: 'First line.\nMore.' })).description).toBe('Sorts the inbox')
    expect(agentToForm(agent({ metadata: {}, instructions: 'First line.\nMore.' })).description).toBe('First line.')
    expect(agentToForm(agent({ metadata: {}, instructions: `${'x'.repeat(200)}\nMore.` })).description).toBe('x'.repeat(160))
    expect(emptyForm('m1').description).toBe('')
  })

  it('requires a nonempty description on one line within the API limit', () => {
    expect(descriptionError('')).toBe('Give the agent a one-line description.')
    expect(descriptionError('   ')).toBe('Give the agent a one-line description.')
    expect(descriptionError('First line\nSecond line')).toBe('Use one line for the description.')
    expect(descriptionError('x'.repeat(161))).toBe('Use at most 160 characters for the description.')
    expect(descriptionError('Reviews pull requests')).toBeNull()
  })
})

describe('delegation', () => {
  it('round-trips a saved mode and chosen ids', () => {
    const form = agentToForm(agent({
      description: 'Coordinates work',
      delegation: { mode: 'choose', agent_ids: ['agent_2', 'agent_3'] },
    }))
    expect(form.delegation).toEqual({ mode: 'choose', agent_ids: ['agent_2', 'agent_3'] })
    expect(formToParams(form).delegation).toEqual({ mode: 'choose', agent_ids: ['agent_2', 'agent_3'] })
  })

  it('defaults to Any with no ids and clears ids when Off', () => {
    expect(emptyForm('m1').delegation).toEqual({ mode: 'any', agent_ids: [] })
    expect(agentToForm(agent()).delegation).toEqual({ mode: 'any', agent_ids: [] })
    const off = { ...emptyForm('m1'), name: 'A', description: 'Does A', delegation: { mode: 'off' as const, agent_ids: ['agent_2'] } }
    expect(formToParams(off).delegation).toEqual({ mode: 'off', agent_ids: [] })
  })

  it('rejects an unknown mode or ids that are not a list', () => {
    expect(delegationError({ mode: 'any', agent_ids: [] })).toBeNull()
    expect(delegationError({ mode: 'choose', agent_ids: ['agent_2'] })).toBeNull()
    expect(delegationError({ mode: 'bogus' as never, agent_ids: [] })).toBe('Choose a valid delegation mode.')
    expect(delegationError({ mode: 'choose', agent_ids: 'agent_2' as never })).toBe('Choose valid delegate agents.')
  })
})
