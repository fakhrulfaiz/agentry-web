/**
 * Items of the composer's `/` menu: three groups in a fixed order (Commands
 * run on the backend, App commands run in the web app, Skills insert
 * `/name `), a name that exists in several groups shown once (the command
 * wins, then the app command), and the filter ranking.
 */
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead'
import type { AgentCommand } from '@/api/types'
import type { AppCommand } from '@/commands/app-commands'

export const GROUPS = ['Commands', 'App', 'Skills'] as const
export type SlashGroup = (typeof GROUPS)[number]

export interface SlashItemData {
  group: SlashGroup
  name: string
  description: string
  /** Placeholder for text after the name; the row inserts `/name ` and waits for it. */
  hint?: string
  /** A backend command while a turn runs: shown dimmed, refused on run. */
  disabled: boolean
}

export type SlashItem = SearchableItem<SlashItemData>

export interface SlashInputs {
  commands: readonly AgentCommand[]
  app: readonly AppCommand[]
  skills: readonly { name: string; description?: string }[]
  /** A turn is running: backend commands are greyed out. */
  busy: boolean
}

/** The menu rows in group order: Commands, App, Skills. */
export function buildSlashItems({ commands, app, skills, busy }: SlashInputs): SlashItem[] {
  const taken = new Set<string>()
  const row = (group: SlashGroup, name: string, description: string, hint: string | undefined, disabled = false): SlashItem | null => {
    if (taken.has(name)) return null
    taken.add(name)
    return { id: `${group}:${name}`, label: name, auxiliaryData: { group, name, description, ...(hint ? { hint } : {}), disabled } }
  }
  const rows = [
    ...commands.map((c) => row('Commands', c.name, c.description, c.input_hint, busy)),
    ...app.map((c) => row('App', c.name, c.description, c.hint)),
    ...skills.map((s) => row('Skills', s.name, s.description ?? '', undefined)),
  ]
  return rows.filter((item): item is SlashItem => item !== null)
}

/** 0 name prefix, 1 name substring, 2 description substring, `null` no match. */
function rank(data: SlashItemData, query: string): number | null {
  if (query === '') return 0
  const name = data.name.toLowerCase()
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (data.description.toLowerCase().includes(query)) return 2
  return null
}

/** Search source over `items`: groups keep their order; within a group, better matches come first. */
export function slashSource(items: SlashItem[]): SearchSource<SlashItem> {
  const search = (raw: string): SlashItem[] => {
    const query = raw.trim().toLowerCase()
    return items
      .map((item, index) => ({ item, index, r: rank(item.auxiliaryData!, query) }))
      .filter((x): x is { item: SlashItem; index: number; r: number } => x.r !== null)
      .sort((a, b) => GROUPS.indexOf(a.item.auxiliaryData!.group) - GROUPS.indexOf(b.item.auxiliaryData!.group) || a.r - b.r || a.index - b.index)
      .map((x) => x.item)
  }
  return { search, bootstrap: () => search('') }
}
