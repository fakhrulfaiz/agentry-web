import { describe, expect, it } from 'vitest'
import { applyDraft } from '@/agents/draft'
import { toAgentJson, toAgentMarkdown } from '@/agents/export'
import { descriptionError, emptyForm } from '@/agents/form'
import type { OAIAgent } from '@/api/types'
import { allowedPath } from '@/server/allowlist'

describe('agent import allow-list', () => {
  it('allows POST /agents/import only and never reads import as an agent id', () => {
    expect(allowedPath('POST', '/agents/import')).toBe('/agents/import')
    expect(allowedPath('GET', '/agents/import')).toBeNull()
    expect(allowedPath('DELETE', '/agents/import')).toBeNull()
    expect(allowedPath('GET', '/agents/connectors')).toBeNull()
  })
})

describe('applyDraft', () => {
  const catalog = ['read', 'grep', 'bash']
  it('fills name, instructions and known tools; keeps the default model unless the draft names a known one', () => {
    const form = applyDraft(emptyForm('deepseek-flash'), {
      name: 'Code reviewer', instructions: 'Review.', metadata: { description: 'd', source_url: 'https://github.com/x' },
      host_tools: { allow: ['read', 'nope'] }, multi_agent: { enabled: true },
    }, catalog, ['deepseek-flash'])
    expect(form).toMatchObject({ name: 'Code reviewer', description: 'd', instructions: 'Review.', model: 'deepseek-flash', allTools: false, tools: ['read'], subagents: true })
    expect(form.extraMetadata).toEqual({ source_url: 'https://github.com/x' })
    expect(applyDraft(emptyForm('a'), { model: 'b' }, catalog, ['a']).model).toBe('a')
    expect(applyDraft(emptyForm('a'), { model: 'b' }, catalog, ['a', 'b']).model).toBe('b')
    expect(applyDraft(emptyForm('a'), { host_tools: { allow: ['nope'] } }, catalog).allTools).toBe(true)
  })

  it('maps delegation from a draft and clears ids when the mode is Off', () => {
    const form = applyDraft(emptyForm('a'), {
      name: 'Coordinator', description: 'Coordinates work',
      delegation: { mode: 'choose', agent_ids: ['agent_2', 'agent_3'] },
    }, catalog, ['a'])
    expect(form.delegation).toEqual({ mode: 'choose', agent_ids: ['agent_2', 'agent_3'] })
    expect(applyDraft(emptyForm('a'), { delegation: { mode: 'off', agent_ids: ['agent_2'] } }, catalog).delegation).toEqual({ mode: 'off', agent_ids: [] })
  })

  it('leaves the description empty when a draft has none, so the form asks for it', () => {
    const form = applyDraft(emptyForm('a'), { name: 'ECC agent', instructions: 'First line.\nMore.' }, catalog, ['a'])
    expect(form.description).toBe('')
    expect(descriptionError(form.description)).toBe('Give the agent a one-line description.')
  })
})

describe('export', () => {
  const agent = {
    id: 'agent_1', object: 'agent', created_at: 1, updated_at: 2, name: 'Code reviewer', instructions: 'Review code.\nCarefully.', model: 'deepseek-flash',
    description: 'Reviews code well', metadata: { description: 'Reviews code' }, delegation: { mode: 'choose', agent_ids: ['agent_2'] },
    host_tools: { allow: ['read', 'grep', 'skill'] }, multi_agent: { enabled: true },
    tools: [{ type: 'mcp', server_label: 'x', transport: { type: 'http', server_url: 'https://e.com', headers: { k: '***' } } }],
  } as unknown as OAIAgent

  it('JSON drops id, timestamps and MCP tools', () => {
    const json = JSON.parse(toAgentJson(agent)) as Record<string, unknown>
    expect(json).not.toHaveProperty('id')
    expect(json).not.toHaveProperty('created_at')
    expect(json).not.toHaveProperty('tools')
    expect(toAgentJson(agent)).not.toContain('***')
    expect(json).toMatchObject({ name: 'Code reviewer', description: 'Reviews code well', delegation: { mode: 'choose', agent_ids: ['agent_2'] }, instructions: 'Review code.\nCarefully.' })
  })

  it('Markdown has the front matter the importer reads', () => {
    expect(toAgentMarkdown(agent)).toBe('---\nname: code-reviewer\ndescription: "Reviews code well"\ntools: Read, Grep, Task\n---\n\nReview code.\nCarefully.\n')
  })
})
