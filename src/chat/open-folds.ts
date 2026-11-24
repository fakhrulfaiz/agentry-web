/**
 * Which finished-turn folds the user opened in a chat, kept for the browser
 * session so a fold stays open when the conversation remounts (a new chat
 * moving to its own page) or the page reloads. Storage that is missing,
 * blocked or malformed reads as nothing open.
 */
const key = (sessionId: string) => `agentry:open-folds:${sessionId}`

export function readOpenFolds(sessionId: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key(sessionId)) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeOpenFolds(sessionId: string, open: ReadonlySet<string>): void {
  try {
    if (open.size === 0) sessionStorage.removeItem(key(sessionId))
    else sessionStorage.setItem(key(sessionId), JSON.stringify([...open]))
  } catch {
    // Private mode or blocked storage: the folds just do not survive a reload.
  }
}
