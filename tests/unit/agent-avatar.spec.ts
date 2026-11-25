import { describe, expect, it } from 'vitest'
import { AGENT_COLORS, AGENT_ICONS, avatarOf } from '@/agents/avatar'
import { agentToForm, emptyForm, formToParams } from '@/agents/form'
import type { OAIAgent } from '@/api/types'

const agent = (metadata: Record<string, string>, id = 'agent_1'): OAIAgent => ({ id, object: 'agent', created_at: 1, updated_at: 1, name: 'A', instructions: null, model: 'm', metadata, tools: [] })

describe('avatarOf', () => {
  it('uses the saved icon and colour', () => {
    expect(avatarOf(agent({ icon: 'mail', color: 'teal' }))).toEqual({ icon: 'mail', color: 'teal' })
  })
  it('falls back to a stable choice per agent for missing or unknown values', () => {
    const a = avatarOf(agent({}, 'agent_xyz'))
    expect(avatarOf(agent({}, 'agent_xyz'))).toEqual(a)
    expect(Object.keys(AGENT_ICONS)).toContain(a.icon)
    expect(AGENT_COLORS).toContain(a.color)
    expect(avatarOf(agent({ icon: 'nope', color: 'mauve' }, 'agent_xyz'))).toEqual(a)
  })
})

describe('agent form avatar', () => {
  it('round-trips icon and colour through metadata, keeping other keys', () => {
    const form = agentToForm(agent({ icon: 'code', color: 'violet', note: 'x' }))
    expect(form).toMatchObject({ icon: 'code', color: 'violet', extraMetadata: { note: 'x' } })
    expect(formToParams(form).metadata).toEqual({ note: 'x', icon: 'code', color: 'violet' })
  })
  it('a new agent starts with an icon and colour', () => {
    const form = emptyForm('m')
    expect(Object.keys(AGENT_ICONS)).toContain(form.icon)
    expect(AGENT_COLORS).toContain(form.color)
  })
})
