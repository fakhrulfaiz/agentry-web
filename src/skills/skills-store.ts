/**
 * The skills Agentry can use, for the `/` menu: one list per chat (the
 * session's agent decides which skills it has), plus one for the new-chat
 * page. `useSkillsLoader(sessionId)` fetches in the background, again when the
 * chat changes and on window focus (at most once per `REFRESH_MS` per chat). A
 * failed fetch keeps the previous list, so the group stays hidden with no error.
 */
import { api } from '@/api/client'
import { createKeyedStore, REFRESH_MS } from '@/commands/list-store'
import type { SlashCommand } from '@/ui/chat/Composer'

export { REFRESH_MS }

const store = createKeyedStore<SlashCommand>(async (sessionId) => {
  const body = await api.listSkills(sessionId)
  return body.data.map((s) => ({ name: s.name, ...(s.description ? { description: s.description } : {}) }))
})

/** Replaces the skills of a chat (or of the new-chat page without `sessionId`). */
export const setSkills = store.set
/** Empties the store (tests). */
export const resetSkills = store.reset
/** Fetches the skills of a chat unless one is running or the last attempt is under `REFRESH_MS` old. */
export const refreshSkills = store.refresh
/** The skills as `/` menu entries; empty until loaded or when loading failed. */
export const useSkillCommands = store.useList
/** Loads the skills on mount, when the chat changes and on window focus. */
export const useSkillsLoader = store.useLoader
