import { describe, expect, it, vi } from 'vitest'
import { withAgentConnectorNote } from '@/server/agent-connectors'

describe('withAgentConnectorNote', () => {
  const saved = { instructions: 'Review.', metadata: { connectors: 'gmail' } }
  it('overlays instructions with the app note for a saved agent with connectors', async () => {
    const out = (await withAgentConnectorNote({ agent_id: 'a1', agent: { model: 'm' }, input: 'hi' }, async () => saved)) as { agent: { model: string; instructions: string } }
    expect(out.agent.model).toBe('m')
    expect(out.agent.instructions).toBe('Review.\n\nUse only these connected apps: gmail. Do not use other connected apps.')
  })
  it('leaves the body alone without agent_id, without connectors, or when the agent is missing', async () => {
    const fetchAgent = vi.fn(async () => saved)
    const plain = { agent: { model: 'm' }, input: 'hi' }
    expect(await withAgentConnectorNote(plain, fetchAgent)).toBe(plain)
    expect(fetchAgent).not.toHaveBeenCalled()
    const none = { agent_id: 'a1', input: 'hi' }
    expect(await withAgentConnectorNote(none, async () => ({ instructions: 'x', metadata: {} }))).toBe(none)
    expect(await withAgentConnectorNote(none, async () => null)).toBe(none)
  })
})
