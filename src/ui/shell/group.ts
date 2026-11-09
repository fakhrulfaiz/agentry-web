/**
 * Sidebar grouping: Today / Yesterday / Earlier by the viewer's local calendar
 * date. `created_at` is Agentry's Unix time in seconds. Order within a group
 * is kept as given (the list arrives newest first).
 */
export function groupSessions<S extends { created_at: number }>(
  sessions: S[],
  now: Date,
): { today: S[]; yesterday: S[]; earlier: S[] } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  const groups = { today: [] as S[], yesterday: [] as S[], earlier: [] as S[] }
  for (const session of sessions) {
    const at = session.created_at * 1000
    if (at >= startOfToday) groups.today.push(session)
    else if (at >= startOfYesterday) groups.yesterday.push(session)
    else groups.earlier.push(session)
  }
  return groups
}

/** The title the sidebar and top bar show for a session. */
export function sessionTitle(session: { metadata?: Record<string, string> | null }): string {
  return session.metadata?.title?.trim() || 'New chat'
}
