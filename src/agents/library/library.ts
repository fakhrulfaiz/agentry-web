/**
 * The agent Library: the built-in agents (adapted from ECC, served by the API at `/agents/library/builtin`)
 * plus the agent files of the user's sources (`/agents/library/sources`). Nothing becomes an agent until
 * the user adds one: Add opens the editor with a draft, like Import. Client-safe and pure.
 */
import type { AgentDraft, LibraryCandidate, LibrarySource, OAIAgent } from '@/api/types'
import type { PendingDraft } from '@/agents/draft'

/** The built-in source's label; always listed first. */
export const BUILTIN_SOURCE = 'Agentry'

/** One agent in the Library. */
export interface LibraryItem {
  /** Stored as `metadata.library_ref` on agents added from it: `<source label>:<file or URL>`. */
  ref: string
  /** The source's label ("Agentry", "ECC"). */
  source: string
  /** The user source's id; absent for built-ins. */
  sourceId?: string
  /** Display name ("Code reviewer"). */
  name: string
  /** File name without `.md`, or the remote file's `name`. */
  slug: string
  description: string
  /** Built-ins: the file's text. */
  text?: string
  /** Built-ins: the agent the file describes, as the API's import drafts it. */
  draft?: AgentDraft
  /** Built-ins: the ECC original (front matter `source`). */
  origin?: string
  /** User sources: the file's link (for `importAgent({ url })`). */
  url?: string
  /** Built-ins: avatar icon and colour names (`src/agents/avatar.ts`). */
  icon?: string
  color?: string
  /** Built-ins: what the agent uses beyond tools, for the card. */
  browser?: boolean
  subagents?: boolean
  apps?: string[]
}

/** A Library item plus whether the user already has an agent added from it. */
export type ListedItem = LibraryItem & { added: boolean }

/** `code-reviewer` → "Code reviewer" (the API import's rule). */
export function titleFromSlug(name: string): string {
  const words = name.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `<label>:<file or URL>`, the value kept in `metadata.library_ref`. */
export const refOf = (label: string, path: string): string => `${label}:${path}`.slice(0, 512)

/** A source's agent files as Library items. */
export function sourceItems(source: LibrarySource, candidates: readonly LibraryCandidate[]): LibraryItem[] {
  return candidates.map((c) => ({
    ref: refOf(source.label, c.url),
    source: source.label,
    sourceId: source.id,
    name: titleFromSlug(c.name),
    slug: c.name,
    description: c.description,
    url: c.url,
  }))
}

/**
 * Every Library item, built-ins first, then each source in order, each marked `added` when one of
 * `agents` was added from it (`metadata.library_ref`).
 */
export function mergeLibrary(builtins: readonly LibraryItem[], sources: ReadonlyArray<{ source: LibrarySource; candidates: readonly LibraryCandidate[] }>, agents: readonly OAIAgent[]): ListedItem[] {
  const added = new Set(agents.map((a) => a.metadata?.library_ref).filter((r): r is string => typeof r === 'string'))
  return [...builtins, ...sources.flatMap(({ source, candidates }) => sourceItems(source, candidates))].map((item) => ({ ...item, added: added.has(item.ref) }))
}

/**
 * The name an added agent starts with: `name`, or "<name> (<source label>)" when the user already has
 * an agent called `name` (then a number when that is taken too). Case-insensitive.
 */
export function nameForAdd(name: string, label: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!taken.has(name.trim().toLowerCase())) return name
  const base = `${name} (${label})`
  let candidate = base
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} ${String(n)}`
  return candidate
}

/** The editor draft for a Library item: the collision-safe name and the source kept in metadata. */
export function libraryDraft(item: LibraryItem, draft: AgentDraft, notes: string[], agents: readonly OAIAgent[]): PendingDraft {
  return {
    draft: {
      ...draft,
      name: nameForAdd(draft.name || item.name, item.source, agents.map((a) => a.name ?? '')),
      metadata: { ...(draft.metadata ?? {}), library_source: item.source, library_ref: item.ref },
    },
    notes,
    ...(item.url ? { sourceUrl: item.url } : {}),
  }
}
