/** Agents page logic: saved agent <-> form <-> request body. Client-safe and pure. */
import { avatarOf, defaultAvatar } from './avatar'
import type { HueName } from '@/ui/brand/palette'
import type { AgentAppGrants, AgentSkillSelection, CreateAgentParams, OAIAgent, ReasoningEffort } from '@/api/types'

export type EffortChoice = 'auto' | Extract<ReasoningEffort, 'low' | 'medium' | 'high'>

export interface AgentForm {
  name: string
  /** Avatar icon name (`AGENT_ICONS`) and colour, saved in metadata. */
  icon: string
  color: HueName
  model: string
  effort: EffortChoice
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
  /** Other metadata keys on the record, kept as they were. */
  extraMetadata: Record<string, string>
}

export const MAX_SUBAGENTS = 8
export const CONNECTORS_KEY = 'connectors'

export const emptyForm = (model = ''): AgentForm => ({
  name: '', ...defaultAvatar(`new-${String(Date.now())}`), model, effort: 'auto', instructions: '', allTools: true, tools: [], deniedTools: [],
  apps: null, skills: null, sendPolicy: 'ask', browser: 'auto', subagents: false, maxSubagents: 3, extraMetadata: {},
})

/** Grants from a saved agent: `apps`, else the legacy `metadata.connectors` list (all tools each), else unrestricted. */
export function grantsOf(agent: Pick<OAIAgent, 'apps' | 'metadata'>): AgentAppGrants | null {
  if (agent.apps) return agent.apps
  const legacy = (agent.metadata?.[CONNECTORS_KEY] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return legacy.length === 0 ? null : Object.fromEntries(legacy.map((slug) => [slug, 'all' as const]))
}

export function agentToForm(agent: OAIAgent, defaultModel = ''): AgentForm {
  const { [CONNECTORS_KEY]: _legacy, icon: _icon, color: _color, ...extraMetadata } = agent.metadata ?? {}
  const allow = agent.host_tools?.allow
  const effort = agent.reasoning?.effort
  return {
    name: agent.name ?? '',
    ...avatarOf(agent),
    model: agent.model || defaultModel,
    effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'auto',
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
    instructions: form.instructions,
    metadata,
    host_tools: mask,
    multi_agent: { enabled: form.subagents, ...(form.subagents ? { max_concurrent_subagents: form.maxSubagents } : {}) },
    reasoning: form.effort === 'auto' ? null : { effort: form.effort },
    apps: form.apps,
    skills: form.skills,
    send_policy: form.sendPolicy,
    browser: form.browser === 'on' ? true : form.browser === 'off' ? false : null,
  }
}
