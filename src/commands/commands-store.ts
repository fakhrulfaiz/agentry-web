/**
 * The Host slash commands of a chat, for the `/` menu. One list per session
 * (the catalog depends on the session's preset); without a session there is
 * nothing to load. `useCommandsLoader(sessionId)` fetches when the chat
 * changes and on window focus (at most once per `REFRESH_MS` per chat). A
 * failed fetch keeps the previous list, so the Commands group stays hidden.
 */
import { api } from '@/api/client'
import type { AgentCommand } from '@/api/types'
import { createKeyedStore } from './list-store'

const store = createKeyedStore<AgentCommand>(
  async (sessionId) => (await api.listCommands(sessionId)).data,
  (sessionId) => sessionId !== undefined,
)

/** Replaces the commands of a chat. */
export const setCommands = store.set
/** Empties the store (tests). */
export const resetCommands = store.reset
/** Fetches the commands of a chat unless one is running or the last attempt is under `REFRESH_MS` old. */
export const refreshCommands = store.refresh
/** The chat's commands; empty until loaded, when loading failed, or without a chat. */
export const useCommandList = store.useList
/** Loads the commands on mount, when the chat changes and on window focus. */
export const useCommandsLoader = store.useLoader
