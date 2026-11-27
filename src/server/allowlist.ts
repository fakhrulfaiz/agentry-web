/** Id segments Agentry issues; anything else (dots, `%`, `/`) is rejected. */
export const ID_SEGMENT = /^[A-Za-z0-9_-]+$/

/** Names under `/agents/` that are routes, never an agent id. */
const RESERVED_AGENT_IDS = new Set(['sessions', 'tools', 'environments', 'schedules', 'skills', 'artifacts', 'commands', 'files', 'projects'])

type Segment = string | { id: 'agent' | 'session' | 'subagent' | 'schedule' | 'artifact' | 'command' | 'file' | 'template' | 'environment' | 'skill' | 'terminal' | 'turn' | 'index' | 'project' }
interface Rule {
  methods: readonly string[]
  segments: readonly Segment[]
}

const AGENT = { id: 'agent' } as const
const SESSION = { id: 'session' } as const
const SUBAGENT = { id: 'subagent' } as const
const SCHEDULE = { id: 'schedule' } as const
const FILE = { id: 'file' } as const
const TEMPLATE = { id: 'template' } as const
const ENVIRONMENT = { id: 'environment' } as const
const SKILL = { id: 'skill' } as const
const PROJECT = { id: 'project' } as const
const TERMINAL = { id: 'terminal' } as const
const TURN = { id: 'turn' } as const
/** A file's position in a turn's changes. */
const INDEX = { id: 'index' } as const
const INDEX_SEGMENT = /^[0-9]{1,5}$/
/** Installed skill ids Agentry issues. */
const SKILL_ID = /^skill_[a-f0-9]{32}$/

/**
 * F1's allow-list, relative to the upstream `/v1` prefix (spec §5), plus the
 * read-only subagent routes of F1.1. The SSE stream has its own route.
 */
const RULES: readonly Rule[] = [
  { methods: ['GET'], segments: ['agents', 'tools'] },
  { methods: ['GET'], segments: ['agents', 'skills'] },
  { methods: ['GET'], segments: ['agents', 'commands'] },
  // Artifacts listing; the bytes live under session workspace paths and their
  // dedicated route validates those segments itself (see artifact-bytes).
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'artifacts'] },
  // Files the agent delivered with `present`; the cards list only these.
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'deliverables'] },
  // Files each turn changed, and one file's diff.
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'changes'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'turns', TURN, 'changes'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'turns', TURN, 'changes', INDEX] },
  // Attachments: the upload has its own streaming route; content and delete go through the proxy.
  { methods: ['POST'], segments: ['agents', 'files'] },
  { methods: ['GET'], segments: ['agents', 'files', FILE, 'content'] },
  { methods: ['DELETE'], segments: ['agents', 'files', FILE] },
  // Sandboxes: providers, templates, environments and their files. File bytes have their own route.
  { methods: ['GET'], segments: ['agents', 'environments', 'providers'] },
  { methods: ['GET'], segments: ['agents', 'environments', 'runtimes'] },
  { methods: ['GET', 'POST'], segments: ['agents', 'environments', 'templates'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'environments', 'templates', TEMPLATE] },
  { methods: ['GET', 'POST'], segments: ['agents', 'environments'] },
  { methods: ['GET', 'DELETE'], segments: ['agents', 'environments', ENVIRONMENT] },
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'start'] },
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'stop'] },
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'reset'] },
  { methods: ['GET', 'POST'], segments: ['agents', 'environments', ENVIRONMENT, 'files'] },
  // Interactive shell in a sandbox: open, type, resize, close. The output stream has its own route (SSE).
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'terminals'] },
  { methods: ['DELETE'], segments: ['agents', 'environments', ENVIRONMENT, 'terminals', TERMINAL] },
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'terminals', TERMINAL, 'input'] },
  { methods: ['POST'], segments: ['agents', 'environments', ENVIRONMENT, 'terminals', TERMINAL, 'resize'] },
  { methods: ['GET', 'POST'], segments: ['agents'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', AGENT] },
  { methods: ['GET', 'POST'], segments: ['agents', 'projects'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'projects', PROJECT] },
  { methods: ['POST'], segments: ['agents', 'projects', PROJECT, 'archive'] },
  { methods: ['POST'], segments: ['agents', 'projects', PROJECT, 'unarchive'] },
  { methods: ['GET', 'POST'], segments: ['agents', 'sessions'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'sessions', SESSION] },
  { methods: ['POST'], segments: ['agents', 'sessions', SESSION, 'events'] },
  { methods: ['POST'], segments: ['agents', 'sessions', SESSION, 'commands', { id: 'command' }] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'items'] },
  // The live browser view (`sessions/{id}/browser/live`, SSE) has its own route, like the event stream.
  // Browser take-over: take or hand back control, and the user's input while they have it.
  { methods: ['POST'], segments: ['agents', 'sessions', SESSION, 'browser', 'control'] },
  { methods: ['POST'], segments: ['agents', 'sessions', SESSION, 'browser', 'input'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'turns'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'subagents'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'subagents', SUBAGENT] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'subagents', SUBAGENT, 'items'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'subagents', SUBAGENT, 'turns'] },
  { methods: ['GET', 'POST'], segments: ['agents', 'schedules'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'schedules', SCHEDULE] },
  { methods: ['POST'], segments: ['agents', 'schedules', SCHEDULE, 'pause'] },
  { methods: ['POST'], segments: ['agents', 'schedules', SCHEDULE, 'resume'] },
  { methods: ['POST'], segments: ['agents', 'schedules', SCHEDULE, 'run'] },
  { methods: ['GET'], segments: ['agents', 'schedules', SCHEDULE, 'runs'] },
  { methods: ['GET'], segments: ['agents', 'skills', 'installed'] },
  { methods: ['GET'], segments: ['agents', 'skills', 'view', { id: 'agent' }] },
  { methods: ['POST'], segments: ['agents', 'skills'] },
  { methods: ['POST'], segments: ['agents', 'skills', 'import'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'skills', SKILL] },
  { methods: ['POST'], segments: ['agents', 'skills', SKILL, 'activate'] },
  { methods: ['POST'], segments: ['agents', 'skills', SKILL, 'update'] },
]

function matches(rule: Segment, part: string): boolean {
  if (typeof rule === 'string') return rule === part
  if (!ID_SEGMENT.test(part)) return false
  if (rule.id === 'skill') return SKILL_ID.test(part)
  if (rule.id === 'index') return INDEX_SEGMENT.test(part)
  return rule.id !== 'agent' || !RESERVED_AGENT_IDS.has(part)
}

/**
 * The normalized path (one trailing slash dropped) when `method path` is on the
 * allow-list, else `null`. `path` is the raw, still-encoded path after
 * `/api/agentry`; any `%`, dot segment, empty segment or query rejects it.
 */
export function allowedPath(method: string, path: string): string | null {
  if (!path.startsWith('/')) return null
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  const parts = normalized.slice(1).split('/')
  if (!parts.every((part) => ID_SEGMENT.test(part))) return null
  const verb = method.toUpperCase()
  const ok = RULES.some(
    (rule) =>
      rule.methods.includes(verb) &&
      rule.segments.length === parts.length &&
      rule.segments.every((segment, i) => matches(segment, parts[i])),
  )
  return ok ? normalized : null
}

/** True when `method path` (path after `/api/agentry`) is on the allow-list. */
export function isAllowed(method: string, path: string): boolean {
  return allowedPath(method, path) !== null
}
