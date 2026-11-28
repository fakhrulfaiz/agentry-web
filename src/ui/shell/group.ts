/**
 * Sidebar grouping by the viewer's local calendar date: Today, Yesterday,
 * Previous 7 days, Previous 30 days, Older. `created_at` is Agentry's Unix time
 * in seconds. Order within a group is kept as given (the list arrives newest first).
 */
export function groupSessions<S extends { created_at: number }>(
  sessions: S[],
  now: Date,
): { today: S[]; yesterday: S[]; week: S[]; month: S[]; older: S[] } {
  const dayStart = (back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime()
  const [today, yesterday, week, month] = [dayStart(0), dayStart(1), dayStart(7), dayStart(30)]
  const groups = { today: [] as S[], yesterday: [] as S[], week: [] as S[], month: [] as S[], older: [] as S[] }
  for (const session of sessions) {
    const at = session.created_at * 1000
    if (at >= today) groups.today.push(session)
    else if (at >= yesterday) groups.yesterday.push(session)
    else if (at >= week) groups.week.push(session)
    else if (at >= month) groups.month.push(session)
    else groups.older.push(session)
  }
  return groups
}

/** The title the sidebar and top bar show for a session. */
export function sessionTitle(session: { metadata?: Record<string, string> | null }): string {
  return session.metadata?.title?.trim() || 'New chat'
}
