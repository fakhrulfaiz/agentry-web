import { describe, expect, it } from 'vitest'
import { subagentDraft } from '@/agents/from-subagent'

describe('subagentDraft', () => {
  it('names the agent from the card, puts the prompt under an editable header and keeps the model', () => {
    expect(subagentDraft({ name: 'summarize the logs', prompt: ' Read logs/ and summarize. ', model: 'deepseek-pro' }).draft).toEqual({
      name: 'Summarize the logs',
      instructions: 'You handle tasks like this one:\n\nRead logs/ and summarize.',
      model: 'deepseek-pro',
      multi_agent: { enabled: false },
    })
    expect(subagentDraft({ name: 'x', prompt: 'p' }).draft.model).toBeUndefined()
  })
})
