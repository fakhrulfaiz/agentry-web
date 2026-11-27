import type { OAIAgentSession, OAIProject } from '@/api/types'
import { groupSessions } from './group'

export type SidebarSection =
  | { type: 'project'; project: OAIProject; sessions: OAIAgentSession[] }
  | { type: 'date'; title: string; sessions: OAIAgentSession[] }

/** A chat belongs to the Recent/Unfiled date buckets only when it has no Project. */
export function isUnfiledSession(session: OAIAgentSession): boolean {
  return session.project_id == null
}

/**
 * Sidebar sections in display order: pinned Projects, other active Projects,
 * then the familiar date buckets for unfiled chats. Archived Projects have no
 * permanent section (they are reachable from the Archived menu), and their
 * chats are not mixed into Recent/Unfiled.
 */
export function groupSessionsForSidebar(
  projects: OAIProject[],
  sessions: OAIAgentSession[],
  now: Date = new Date(),
): SidebarSection[] {
  const active = projects.filter((project) => project.status === 'active')
  // Array.prototype.sort is stable, so pinned/non-pinned keep their given order.
  const ordered = [...active].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const newestFirst = [...sessions].sort((a, b) => b.created_at - a.created_at)

  const sections: SidebarSection[] = ordered.map((project) => ({
    type: 'project',
    project,
    sessions: newestFirst.filter((session) => session.project_id === project.id),
  }))

  const groups = groupSessions(
    newestFirst.filter((session) => isUnfiledSession(session)),
    now,
  )
  const buckets: Array<[keyof typeof groups, string]> = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['week', 'Previous 7 days'],
    ['month', 'Previous 30 days'],
    ['older', 'Older'],
  ]
  for (const [key, title] of buckets) {
    if (groups[key].length > 0) sections.push({ type: 'date', title, sessions: groups[key] })
  }

  return sections
}
