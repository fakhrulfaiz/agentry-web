/**
 * The agent Library: the built-in agents (adapted from ECC, `./*.md`, bundled into `files.generated.ts`)
 * plus the agent files of the user's sources (`/agents/library/sources`). Nothing becomes an agent until
 * the user adds one: Add opens the editor with a draft, like Import. Client-safe and pure.
 */
import type { AgentDraft, LibraryCandidate, LibrarySource, OAIAgent } from '@/api/types'
import type { PendingDraft } from '@/agents/draft'
import { LIBRARY_FILES } from './files.generated'

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
  /** Built-ins: the bundled file's text. */
  text?: string
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

/**
 * The front matter of a library file: one `key: value` per line (a value may be double-quoted JSON);
 * `true`/`false` become booleans. `null` without front matter.
 */
export function parseFrontMatter(text: string): { data: Record<string, string | boolean>; body: string } | null {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return null
  const data: Record<string, string | boolean> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim())
    if (!pair) continue
    let value: string | boolean = pair[2] ?? ''
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string
      } catch {
        // Keep the raw text.
      }
    } else if (value === 'true' || value === 'false') {
      value = value === 'true'
    }
    data[pair[1]!] = value
  }
  return { data, body: text.slice(match[0].length) }
}

const list = (value: string | boolean | undefined): string[] =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : []

/**
 * A built-in file as a Library item and its draft: the same shape `POST /agents/import` answers for an
 * Agentry library file (`title`, `tools`, `subagents`, `browser`, `apps`).
 * @throws Error when the file has no `name`/`description` front matter.
 */
export function parseLibraryFile(file: string, text: string): { item: LibraryItem; draft: AgentDraft } {
  const parsed = parseFrontMatter(text)
  const name = parsed?.data['name']
  const description = parsed?.data['description']
  if (!parsed || typeof name !== 'string' || typeof description !== 'string') throw new Error(`${file}: missing name or description`)
  const title = typeof parsed.data['title'] === 'string' && parsed.data['title'] ? parsed.data['title'] : titleFromSlug(name)
  const tools = list(parsed.data['tools'])
  const apps = list(parsed.data['apps'])
  const draft: AgentDraft = {
    name: title,
    instructions: parsed.body.trim(),
    metadata: {
      description: description.slice(0, 512),
      ...(typeof parsed.data['icon'] === 'string' ? { icon: parsed.data['icon'] } : {}),
      ...(typeof parsed.data['color'] === 'string' ? { color: parsed.data['color'] } : {}),
    },
    ...(tools.length > 0 ? { host_tools: { allow: tools } } : {}),
    ...(parsed.data['subagents'] === true ? { multi_agent: { enabled: true } } : {}),
    ...(typeof parsed.data['browser'] === 'boolean' ? { browser: parsed.data['browser'] } : {}),
    ...(apps.length > 0 ? { apps: Object.fromEntries(apps.map((a) => [a, 'all' as const])) } : {}),
  }
  const item: LibraryItem = {
    ref: refOf(BUILTIN_SOURCE, file),
    source: BUILTIN_SOURCE,
    name: title,
    slug: file.replace(/\.md$/, ''),
    description,
    text,
    ...(typeof parsed.data['source'] === 'string' ? { origin: parsed.data['source'] } : {}),
    ...(typeof parsed.data['icon'] === 'string' ? { icon: parsed.data['icon'] } : {}),
    ...(typeof parsed.data['color'] === 'string' ? { color: parsed.data['color'] } : {}),
    ...(parsed.data['browser'] === true ? { browser: true } : {}),
    ...(parsed.data['subagents'] === true ? { subagents: true } : {}),
    ...(apps.length > 0 ? { apps } : {}),
  }
  return { item, draft }
}

const BUILTINS = LIBRARY_FILES.map(({ file, text }) => parseLibraryFile(file, text))

/** The built-in Library, sorted by name. */
export const BUILTIN_LIBRARY: readonly LibraryItem[] = BUILTINS.map((b) => b.item).sort((a, b) => a.name.localeCompare(b.name))

/** The draft for a built-in item. */
export function builtinDraft(item: LibraryItem): AgentDraft | undefined {
  return BUILTINS.find((b) => b.item.ref === item.ref)?.draft
}

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
