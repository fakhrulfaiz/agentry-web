/** Id segments Agentry issues; anything else (dots, `%`, `/`) is rejected. */
export const ID_SEGMENT = /^[A-Za-z0-9_-]+$/

/** Names under `/agents/` that are routes, never an agent id. */
const RESERVED_AGENT_IDS = new Set(['sessions', 'tools', 'environments'])

type Segment = string | { id: 'agent' | 'session' }
interface Rule {
  methods: readonly string[]
  segments: readonly Segment[]
}

const AGENT = { id: 'agent' } as const
const SESSION = { id: 'session' } as const

/** F1's allow-list, relative to the upstream `/v1` prefix (spec §5). The SSE stream has its own route. */
const RULES: readonly Rule[] = [
  { methods: ['GET'], segments: ['agents'] },
  { methods: ['GET'], segments: ['agents', 'tools'] },
  { methods: ['GET'], segments: ['agents', AGENT] },
  { methods: ['GET', 'POST'], segments: ['agents', 'sessions'] },
  { methods: ['GET', 'POST', 'DELETE'], segments: ['agents', 'sessions', SESSION] },
  { methods: ['POST'], segments: ['agents', 'sessions', SESSION, 'events'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'items'] },
  { methods: ['GET'], segments: ['agents', 'sessions', SESSION, 'turns'] },
]

function matches(rule: Segment, part: string): boolean {
  if (typeof rule === 'string') return rule === part
  if (!ID_SEGMENT.test(part)) return false
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
