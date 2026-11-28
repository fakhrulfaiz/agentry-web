/**
 * Drafts for the agent form: an imported definition (`POST /agents/import`) or a chat's subagent
 * ("Save as agent"). The draft waits in a small in-memory slot while the Agents page opens the editor
 * (`/agents?new=1&draft=1`); nothing is saved until the user saves the form. Client-safe and pure.
 */
import type { AgentDraft } from '@/api/types'
import type { AgentForm } from './form'
import { MAX_SUBAGENTS } from './form'
import { AGENT_COLORS, AGENT_ICONS } from './avatar'
import type { HueName } from '@/ui/brand/palette'

/** A draft plus what the form shows above it. */
export interface PendingDraft {
  draft: AgentDraft
  /** Notes from the import (dropped tools, unmapped model). */
  notes: string[]
  /** Where it came from, shown with a license reminder. */
  sourceUrl?: string
}

let pending: PendingDraft | null = null

/** Hold a draft for the next editor the Agents page opens. */
export function setPendingDraft(draft: PendingDraft): void {
  pending = draft
}

/** The held draft, if any. */
export function pendingDraft(): PendingDraft | null {
  return pending
}

/**
 * The form with the draft applied. The draft's model is kept only when it is one of `models`
 * (else the user's default stays); host tools only when in `catalog`.
 */
export function applyDraft(base: AgentForm, draft: AgentDraft, catalog: string[], models: string[] = []): AgentForm {
  const next: AgentForm = { ...base, extraMetadata: { ...base.extraMetadata } }
  if (draft.name) next.name = draft.name
  if (typeof draft.instructions === 'string') next.instructions = draft.instructions
  if (draft.model && models.includes(draft.model)) next.model = draft.model
  const { icon, color, connectors: _connectors, ...metadata } = draft.metadata ?? {}
  Object.assign(next.extraMetadata, metadata)
  // A Library agent brings its avatar; anything unknown keeps the form's.
  if (icon && icon in AGENT_ICONS) next.icon = icon
  if (color && (AGENT_COLORS as readonly string[]).includes(color)) next.color = color as HueName
  const allow = draft.host_tools?.allow?.filter((t) => catalog.length === 0 || catalog.includes(t))
  if (allow && allow.length > 0) {
    next.allTools = false
    next.tools = allow
  }
  const deny = draft.host_tools?.deny?.filter((t) => catalog.length === 0 || catalog.includes(t))
  if (deny && deny.length > 0) next.deniedTools = deny
  if (draft.multi_agent) {
    next.subagents = draft.multi_agent.enabled
    if (draft.multi_agent.max_concurrent_subagents) next.maxSubagents = Math.min(MAX_SUBAGENTS, Math.max(1, draft.multi_agent.max_concurrent_subagents))
  }
  const effort = draft.reasoning?.effort
  if (effort === 'low' || effort === 'medium' || effort === 'high') next.effort = effort
  if (draft.apps !== undefined) next.apps = draft.apps
  if (draft.send_policy === 'ask' || draft.send_policy === 'auto') next.sendPolicy = draft.send_policy
  if (typeof draft.browser === 'boolean') next.browser = draft.browser ? 'on' : 'off'
  return next
}
