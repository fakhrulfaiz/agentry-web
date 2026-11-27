/**
 * "Always show steps": a finished turn's work block starts expanded instead of
 * collapsed to its summary. A per-browser preference; storage that is missing
 * or blocked reads as off.
 */
import type { FirstSend } from '@/chat/pending-first'
import type { MessageView } from '@/chat/reducer'

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
 * @param firstSend - the handoff from the new-chat page, if this chat was just created.
 * @param ready - the session status is known (a snapshot or stream frame was read).
 */
export function waitingLabel(loading: boolean, status: string, firstSend: FirstSend | null = null, ready = true): string {
  if (firstSend && !ready) return firstSend.startLabel
  if (loading && !firstSend) return 'Loading conversation…'
  return status === 'in_progress' ? 'Agentry is thinking…' : 'Sending…'
}

/**
 * Whether any assistant-side view the chat renders is already on screen.
 * User rows are not output, and an empty assistant message renders nothing;
 * every other view (including a reasoning header with no text yet) is visible.
 */
export function hasVisibleOutput(items: MessageView[]): boolean {
  return items.some((view) => {
    if (view.kind === 'user') return false
    if (view.kind === 'assistant') return view.text.trim() !== ''
    return true
  })
}

export type WaitOptions = {
  loading: boolean
  ready: boolean
  status: string
  sent: boolean
  firstSend: boolean
  visibleOutput: boolean
  endedInNotice: boolean
  closedReason: boolean
  unavailable: boolean
}

/** Whether the waiting row should still be shown for the current turn. */
export function shouldWaitForOutput(options: WaitOptions): boolean {
  if (options.closedReason || options.unavailable || options.visibleOutput || options.endedInNotice) return false
  if (options.loading) return true
  if (options.firstSend) return !(options.ready && (options.status === 'idle' || options.status === 'failed'))
  return options.sent || options.status === 'in_progress'
}
