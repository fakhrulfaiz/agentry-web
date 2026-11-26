'use client'

/**
 * Model and reasoning effort for an open chat. The menus start at the
 * session's stored values; the next message carries only the fields the user
 * changed (Agentry applies them before queueing it). `revert()` puts the menus
 * back to the stored values (after a refused change); a change Agentry
 * accepted is folded into the session with `withSettings`.
 */
import { useState } from 'react'
import type { SettingsChange } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import type { EffortChoice } from './Composer'

export interface ChatSettings {
  model: string
  effort: EffortChoice
}

const EFFORT_CHOICES = new Set<string>(['low', 'medium', 'high'])

/** The session's stored model and effort (an effort the menu does not offer, or none, reads as Auto). */
export function storedSettings(session: OAIAgentSession | null): ChatSettings {
  const effort = session?.agent.reasoning?.effort
  return {
    model: session?.agent.model ?? '',
    effort: effort && EFFORT_CHOICES.has(effort) ? (effort as EffortChoice) : 'auto',
  }
}

/** The fields of `chosen` that differ from `stored`. Choosing Auto over a stored effort sends `effort: null`, which clears it. */
export function settingsChange(stored: ChatSettings, chosen: ChatSettings): SettingsChange {
  return {
    ...(chosen.model && chosen.model !== stored.model ? { model: chosen.model } : {}),
    ...(chosen.effort !== stored.effort ? { effort: chosen.effort === 'auto' ? null : chosen.effort } : {}),
  }
}

/** `session` with an accepted change applied to its agent settings. */
export function withSettings(session: OAIAgentSession, change: SettingsChange): OAIAgentSession {
  if (!change.model && change.effort === undefined) return session
  const agent = { ...session.agent }
  if (change.model) agent.model = change.model
  if (change.effort) agent.reasoning = { ...agent.reasoning, effort: change.effort }
  else if (change.effort === null) {
    const { effort: _cleared, ...rest } = agent.reasoning ?? {}
    agent.reasoning = rest
  }
  return { ...session, agent }
}

export function useChatSettings(session: OAIAgentSession | null) {
  const stored = storedSettings(session)
  const id = session?.id ?? null
  // Choices belong to one session; another session starts from its own stored values.
  const [chosen, setChosen] = useState<{ id: string | null; model?: string; effort?: EffortChoice }>({ id })
  const own = chosen.id === id ? chosen : { id }
  const current: ChatSettings = { model: own.model ?? stored.model, effort: own.effort ?? stored.effort }
  return {
    ...current,
    change: settingsChange(stored, current),
    setModel: (model: string) => setChosen({ ...own, model }),
    setEffort: (effort: EffortChoice) => setChosen({ ...own, effort }),
    revert: () => setChosen({ id }),
  }
}
