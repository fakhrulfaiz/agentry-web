/**
 * "Always show steps": a finished turn's work block starts expanded instead of
 * collapsed to its summary. A per-browser preference; storage that is missing
 * or blocked reads as off.
 */
const KEY = 'agentry:show-steps'

export function readShowSteps(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeShowSteps(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/**
 * The waiting row's text, by what is actually happening.
 * @param loading - the conversation's history is still arriving.
 * @param status - the session status.
 */
export function waitingLabel(loading: boolean, status: string): string {
  if (loading) return 'Loading conversation…'
  return status === 'in_progress' ? 'Agentry is thinking…' : 'Sending…'
}
