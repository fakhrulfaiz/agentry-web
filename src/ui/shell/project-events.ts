'use client'

/**
 * Projects are shared by the sidebar, the new-chat page and their dialogs. A
 * change in one view is broadcast on `window` so every other view reloads its
 * Projects; the event carries no detail, since all of them need a fresh list.
 */
import { useEffect, useRef } from 'react'

/** Fired on `window` when a Project was created, renamed, moved or removed. */
export const PROJECTS_CHANGED = 'agentry:projects-changed'

/** Tells every open view of Projects to reload them. */
export function announceProjects(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED))
}

/** Calls `handler` for each Project change, always using the latest callback. */
export function useProjectChanges(handler: () => void): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const listen = () => latest.current()
    window.addEventListener(PROJECTS_CHANGED, listen)
    return () => window.removeEventListener(PROJECTS_CHANGED, listen)
  }, [])
}
