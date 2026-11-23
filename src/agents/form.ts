/** Agents page logic: saved agent <-> form <-> request body. Client-safe and pure. */
import type { AgentAppGrants, AgentSkillSelection, CreateAgentParams, OAIAgent, ReasoningEffort } from '@/api/types'

export type EffortChoice = 'auto' | Extract<ReasoningEffort, 'low' | 'medium' | 'high'>

export interface AgentForm {
  name: string
  model: string
  effort: EffortChoice
  instructions: string
  /** True: no Host tool mask (every tool). */
  allTools: boolean
  /** Allowed Host tool names, used when `allTools` is false. */
  tools: string[]
  /** Connected-app grants; `null` lets the agent use every connected app. */
  apps: AgentAppGrants | null
  /** Skill selection; `null` uses every built-in skill. */
  skills: AgentSkillSelection | null
  /** Ask before each write on the user's behalf, or send without asking. */
  sendPolicy: 'ask' | 'auto'
  subagents: boolean
  maxSubagents: number
  /** Other metadata keys on the record, kept as they were. */
  extraMetadata: Record<string, string>
}

export const MAX_SUBAGENTS = 8
export const CONNECTORS_KEY = 'connectors'

export const emptyForm = (model = ''): AgentForm => ({
  name: '', model, effort: 'auto', instructions: '', allTools: true, tools: [],
  apps: null, skills: null, sendPolicy: 'ask', subagents: false, maxSubagents: 3, extraMetadata: {},
})

/** Grants from a saved agent: `apps`, else the legacy `metadata.connectors` list (all tools each), else unrestricted. */
export function grantsOf(agent: Pick<OAIAgent, 'apps' | 'metadata'>): AgentAppGrants | null {
  if (agent.apps) return agent.apps
  const legacy = (agent.metadata?.[CONNECTORS_KEY] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return legacy.length === 0 ? null : Object.fromEntries(legacy.map((slug) => [slug, 'all' as const]))
}

export function agentToForm(agent: OAIAgent, defaultModel = ''): AgentForm {
  const { [CONNECTORS_KEY]: _legacy, ...extraMetadata } = agent.metadata ?? {}
  const allow = agent.host_tools?.allow
  const effort = agent.reasoning?.effort
  return {
    name: agent.name ?? '',
    model: agent.model || defaultModel,
    effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'auto',
    instructions: agent.instructions ?? '',
    allTools: !allow || allow.length === 0,
    tools: allow ?? [],
    apps: grantsOf(agent),
    skills: agent.skills ?? null,
    sendPolicy: agent.send_policy === 'auto' ? 'auto' : 'ask',
    subagents: agent.multi_agent?.enabled ?? false,
    maxSubagents: Math.min(MAX_SUBAGENTS, Math.max(1, agent.multi_agent?.max_concurrent_subagents ?? 3)),
    extraMetadata,
  }
}

/** The request body for create or update. `catalog` is the Host tool list; a mask naming every tool is no mask. */
export function formToParams(form: AgentForm, catalog: string[] = []): CreateAgentParams {
  const everything = catalog.length > 0 && catalog.every((t) => form.tools.includes(t))
  const mask = form.allTools || form.tools.length === 0 || everything ? null : { allow: form.tools }
  const metadata = { ...form.extraMetadata }
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
  }
}

/** The soft app limit as the last line of the instructions; `names` maps slugs to display names. */
export function connectorNote(slugs: string[], names: Record<string, string> = {}): string {
  const list = slugs.map((s) => names[s] ?? s).join(', ')
  return `Use only these connected apps: ${list}. Do not use other connected apps.`
}

/** Instructions for a session: the saved ones plus the soft app limit when the agent has one. */
export function instructionsWithConnectors(saved: string | null | undefined, connectors: string | undefined): string | undefined {
  const slugs = (connectors ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (slugs.length === 0) return undefined
  return [saved?.trim(), connectorNote(slugs)].filter(Boolean).join('\n\n')
}

export type ToolPreset = 'read-only' | 'edit' | 'all'

const READ = /(^|[_.-])(read|grep|glob|find|search|list|ls|view|fetch|cat)([_.-]|$)/i
const WRITE = /(write|edit|patch|apply|create|shell|bash|exec|run|delete|remove|move)/i

/** Tool names a starter's preset allows, matched by name pattern against the Host catalog; `null` means no mask. The form shows the result so the user can adjust it before saving. */
export function toolMask(preset: ToolPreset, catalog: string[]): string[] | null {
  if (preset === 'all' || catalog.length === 0) return null
  const read = catalog.filter((t) => READ.test(t) && !WRITE.test(t))
  if (preset === 'read-only') return read
  return [...new Set([...read, ...catalog.filter((t) => WRITE.test(t))])]
}
