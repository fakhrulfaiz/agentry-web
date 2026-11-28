import type { UserFile } from './attachments'

/** The first message of a chat just created from the new-chat page. */
export type PendingFirst = { text: string; files?: UserFile[]; startLabel?: string }

/** The part of that handoff the conversation needs after it has taken the message. */
export type FirstSend = { startLabel: string }

const pending = new Map<string, PendingFirst>()

/** Remembers the first message so the conversation view shows it before its history loads. */
export function setPendingFirst(sessionId: string, message: PendingFirst): void {
  pending.set(sessionId, message)
}

/** The remembered first message of `sessionId`, if any. */
export function peekPendingFirst(sessionId: string): PendingFirst | undefined {
  return pending.get(sessionId)
}

/** Forgets the remembered first message once the conversation view has taken it. */
export function clearPendingFirst(sessionId: string): void {
  pending.delete(sessionId)
}
