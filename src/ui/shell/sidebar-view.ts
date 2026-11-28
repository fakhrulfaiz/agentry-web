/**
 * The sidebar's Workspace view options (Group by, Order by, Show), remembered per browser.
 */
import type { OAIAgentSession, OAIProject } from '@/api/types'
import { sessionTitle } from './group'

export type GroupBy = 'project' | 'environment' | 'list'
export type OrderBy = 'updated' | 'name'
export type ShowChats = 'all' | 'starred'
export interface SidebarView {
  group: GroupBy
  order: OrderBy
  show: ShowChats
}

export const SIDEBAR_VIEW_KEY = 'agentry_sidebar_view'
export const DEFAULT_VIEW: SidebarView = { group: 'project', order: 'updated', show: 'all' }

const GROUPS: readonly GroupBy[] = ['project', 'environment', 'list']
const ORDERS: readonly OrderBy[] = ['updated', 'name']
const SHOWS: readonly ShowChats[] = ['all', 'starred']

/** The saved view, or the default for anything missing or unknown (storage may be unavailable). */
export function readView(): SidebarView {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SIDEBAR_VIEW_KEY) ?? '{}') as Partial<Record<keyof SidebarView, unknown>>
    return {
      group: GROUPS.includes(raw.group as GroupBy) ? (raw.group as GroupBy) : DEFAULT_VIEW.group,
      order: ORDERS.includes(raw.order as OrderBy) ? (raw.order as OrderBy) : DEFAULT_VIEW.order,
      show: SHOWS.includes(raw.show as ShowChats) ? (raw.show as ShowChats) : DEFAULT_VIEW.show,
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function writeView(view: SidebarView): void {
  try {
    window.localStorage.setItem(SIDEBAR_VIEW_KEY, JSON.stringify(view))
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/** Chats in the chosen order: newest activity first, or by title A–Z. */
export function orderSessions(list: OAIAgentSession[], order: OrderBy): OAIAgentSession[] {
  const copy = [...list]
  return order === 'name'
    ? copy.sort((a, b) => byName(sessionTitle(a), sessionTitle(b)))
    : copy.sort((a, b) => (b.last_active_at ?? b.created_at) - (a.last_active_at ?? a.created_at))
}

/** Projects in the chosen order; "Last updated" keeps the API's order (pinned first). */
export function orderProjects(list: OAIProject[], order: OrderBy): OAIProject[] {
  return order === 'name' ? [...list].sort((a, b) => byName(a.name, b.name)) : list
}

export interface EnvironmentGroup {
  key: string
  title: string
  sessions: OAIAgentSession[]
}

/** The environment a chat runs in: a sandbox environment id, or `local` for chats on the server. */
export function environmentKey(session: OAIAgentSession): string {
  const env = session.environment as { type?: string; environment_id?: unknown } | null | undefined
  return env?.type === 'sandbox' && typeof env.environment_id === 'string' ? env.environment_id : 'local'
}

/**
 * Chats grouped by the environment they run in. Groups follow the chosen order: the one with the
 * newest chat first, or by name. Unknown (deleted) sandboxes are titled "Removed sandbox".
 */
export function groupByEnvironment(list: OAIAgentSession[], names: Record<string, string>, order: OrderBy): EnvironmentGroup[] {
  const groups = new Map<string, OAIAgentSession[]>()
  for (const session of orderSessions(list, order)) {
    const key = environmentKey(session)
    groups.set(key, [...(groups.get(key) ?? []), session])
  }
  const title = (key: string) => (key === 'local' ? 'Server' : names[key] || 'Removed sandbox')
  const result = [...groups].map(([key, sessions]) => ({ key, title: title(key), sessions }))
  return order === 'name' ? result.sort((a, b) => byName(a.title, b.title)) : result
}
