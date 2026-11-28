/** Agents page logic: saved agent <-> form <-> request body. Client-safe and pure. */
import { avatarOf, defaultAvatar } from './avatar'
import type { HueName } from '@/ui/brand/palette'
import type { AgentAppGrants, AgentDelegation, AgentSkillSelection, CreateAgentParams, OAIAgent, ReasoningEffort } from '@/api/types'

export type EffortChoice = 'auto' | Extract<ReasoningEffort, 'low' | 'medium' | 'high'>

export interface AgentForm {
  name: string
  /** Avatar icon name (`AGENT_ICONS`) and colour, saved in metadata. */
  icon: string
  color: HueName
  model: string
  effort: EffortChoice
  /** Required one-line summary; stored on the agent and shown on its card and in the delegation picker. */
  description: string
  instructions: string
  /** True: no Host tool mask (every tool). */
  allTools: boolean
  /** Allowed Host tool names, used when `allTools` is false. */
  tools: string[]
  /** Host tools the saved agent hides (an agent made in chat cannot write agents); kept as saved. */
  deniedTools: string[]
  /** Connected-app grants; `null` lets the agent use every connected app. */
  apps: AgentAppGrants | null
  /** Skill selection; `null` uses every built-in skill. */
  skills: AgentSkillSelection | null
  /** Ask before each write on the user's behalf, or send without asking. */
  sendPolicy: 'ask' | 'auto'
  /** The web browser (Playwright MCP, sandbox chats only): `auto` saves null, `on` true, `off` false. */
  browser: 'auto' | 'on' | 'off'
  subagents: boolean
  maxSubagents: number
  /** Saved agents this one may delegate to; built-in Agentry is always allowed when subagents are on. */
  delegation: AgentDelegation
  /** Other metadata keys on the record, kept as they were. */
  extraMetadata: Record<string, string>
}

export const MAX_SUBAGENTS = 8
export const CONNECTORS_KEY = 'connectors'
/** Must match the API's `DESCRIPTION_MAX`. */
export const DESCRIPTION_MAX = 160

export const emptyForm = (model = ''): AgentForm => ({
  name: '', ...defaultAvatar(`new-${String(Date.now())}`), model, effort: 'auto', description: '', instructions: '', allTools: true, tools: [], deniedTools: [],
  apps: null, skills: null, sendPolicy: 'ask', browser: 'auto', subagents: false, maxSubagents: 3,
  delegation: { mode: 'any', agent_ids: [] }, extraMetadata: {},
})

/** The agent's description, or the legacy fallback: `metadata.description`, then the first instruction line. */
export function descriptionOf(agent: { description?: string | null; metadata?: Record<string, string> | null; instructions?: string | null }): string {
  for (const value of [agent.description, agent.metadata?.description, agent.instructions]) {
    if (typeof value !== 'string') continue
    const first = value.split(/\r?\n/u, 1)[0]?.trim() ?? ''
    if (first) return first.slice(0, DESCRIPTION_MAX)
  }
  return ''
}

/** Why the description cannot be saved, or `null` when it is a nonempty single line. */
export function descriptionError(value: string): string | null {
  const text = value.trim()
  if (!text) return 'Give the agent a one-line description.'
  if (/[\r\n]/u.test(text)) return 'Use one line for the description.'
  if (text.length > DESCRIPTION_MAX) return `Use at most ${String(DESCRIPTION_MAX)} characters for the description.`
  return null
}

/** Normalise a saved delegation setting: unknown modes become Any, ids only survive in Choose. */
export function normalizeDelegation(value: AgentDelegation | null | undefined): AgentDelegation {
  const mode = value?.mode === 'choose' || value?.mode === 'off' ? value.mode : 'any'
  const ids = mode === 'choose' && Array.isArray(value?.agent_ids)
    ? [...new Set(value.agent_ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))]
    : []
  return { mode, agent_ids: ids }
}

/** Why a delegation setting cannot be saved, or `null` when mode and ids are well formed. */
export function delegationError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Choose a valid delegation mode.'
  const setting = value as { mode?: unknown; agent_ids?: unknown }
  if (setting.mode !== 'any' && setting.mode !== 'choose' && setting.mode !== 'off') return 'Choose a valid delegation mode.'
  if (!Array.isArray(setting.agent_ids) || setting.agent_ids.some((id) => typeof id !== 'string')) return 'Choose valid delegate agents.'
  return null
}

/** Grants from a saved agent: `apps`, else the legacy `metadata.connectors` list (all tools each), else unrestricted. */
export function grantsOf(agent: Pick<OAIAgent, 'apps' | 'metadata'>): AgentAppGrants | null {
  if (agent.apps) return agent.apps
  const legacy = (agent.metadata?.[CONNECTORS_KEY] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return legacy.length === 0 ? null : Object.fromEntries(legacy.map((slug) => [slug, 'all' as const]))
}

export function agentToForm(agent: OAIAgent, defaultModel = ''): AgentForm {
  const { [CONNECTORS_KEY]: _legacy, description: _legacyDescription, icon: _icon, color: _color, ...extraMetadata } = agent.metadata ?? {}
  const allow = agent.host_tools?.allow
  const effort = agent.reasoning?.effort
  return {
    name: agent.name ?? '',
    ...avatarOf(agent),
    model: agent.model || defaultModel,
    effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'auto',
    description: descriptionOf(agent),
    instructions: agent.instructions ?? '',
    allTools: !allow || allow.length === 0,
    tools: allow ?? [],
    deniedTools: agent.host_tools?.deny ?? [],
    apps: grantsOf(agent),
    skills: agent.skills ?? null,
    sendPolicy: agent.send_policy === 'auto' ? 'auto' : 'ask',
    browser: agent.browser === true ? 'on' : agent.browser === false ? 'off' : 'auto',
    subagents: agent.multi_agent?.enabled ?? false,
    maxSubagents: Math.min(MAX_SUBAGENTS, Math.max(1, agent.multi_agent?.max_concurrent_subagents ?? 3)),
    delegation: normalizeDelegation(agent.delegation),
    extraMetadata,
  }
}

/** The request body for create or update. `catalog` is the Host tool list; a mask naming every tool is no mask. */
export function formToParams(form: AgentForm, catalog: string[] = []): CreateAgentParams {
  const everything = catalog.length > 0 && catalog.every((t) => form.tools.includes(t))
  const allow = form.allTools || form.tools.length === 0 || everything ? null : form.tools
  const deny = form.deniedTools.length > 0 ? form.deniedTools : null
  const mask = allow || deny ? { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) } : null
  const metadata = { ...form.extraMetadata, icon: form.icon, color: form.color }
  return {
    model: form.model,
    name: form.name.trim(),
    description: form.description.trim(),
    instructions: form.instructions,
    metadata,
    host_tools: mask,
    multi_agent: { enabled: form.subagents, ...(form.subagents ? { max_concurrent_subagents: form.maxSubagents } : {}) },
    reasoning: form.effort === 'auto' ? null : { effort: form.effort },
    apps: form.apps,
    skills: form.skills,
    send_policy: form.sendPolicy,
    browser: form.browser === 'on' ? true : form.browser === 'off' ? false : null,
    delegation: normalizeDelegation(form.delegation),
  }
}
