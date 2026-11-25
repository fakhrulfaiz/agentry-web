'use client'

import { createContext, useContext } from 'react'

/** The id of the chat whose Markdown is being rendered, so workspace images can be served; null elsewhere. */
export const SessionFilesContext = createContext<string | null>(null)

export const useSessionFilesId = (): string | null => useContext(SessionFilesContext)
