/** A chat's subagent as a draft agent ("Save as agent" on the subagent card). Client-safe and pure. */
import type { PendingDraft } from './draft'

/**
 * Name from the card (the delegating call's `description`), instructions from its `prompt` under a
 * header the user is expected to edit, the model it ran when known; tools and apps unrestricted
 * (the child inherited the parent's), subagents off.
 */
export function subagentDraft(view: { name: string; prompt: string; model?: string | undefined }): PendingDraft {
  const name = view.name.trim().slice(0, 80) || 'Subagent'
  return {
    draft: {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      instructions: `You handle tasks like this one:\n\n${view.prompt.trim()}`,
      ...(view.model ? { model: view.model } : {}),
      multi_agent: { enabled: false },
    },
    notes: ['Made from a subagent in a chat. Edit the instructions so they describe the kind of task, not this one task.'],
  }
}
