'use client'

/**
 * The view tabs under a chat's title (Chat, Trajectory): text-only line
 * tabs, the active one in the accent colour on the header's rule. Hidden with
 * fewer than two views. The chosen view is remembered per session in this
 * browser (`localStorage`, best effort).
 */
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { useCallback, useEffect, useState } from 'react'

export interface ViewOption<V extends string> {
  value: V
  label: string
}

const KEY = (sessionId: string) => `agentry_view:${sessionId}`

export function readView<V extends string>(sessionId: string, allowed: readonly V[], fallback: V): V {
  try {
    const saved = window.localStorage.getItem(KEY(sessionId))
    return saved !== null && (allowed as readonly string[]).includes(saved) ? (saved as V) : fallback
  } catch {
    return fallback
  }
}

function writeView(sessionId: string, view: string): void {
  try {
    window.localStorage.setItem(KEY(sessionId), view)
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The view of `sessionId`, starting from the saved one, saved on change. */
export function useSessionView<V extends string>(sessionId: string, allowed: readonly V[], fallback: V): [V, (view: V) => void] {
  const [view, setView] = useState<V>(fallback)
  // Read after mount, so the server render and the first client render agree.
  const allowedKey = allowed.join(',')
  useEffect(() => {
    setView(readView(sessionId, allowedKey.split(',') as V[], fallback))
  }, [sessionId, allowedKey, fallback])
  const choose = useCallback(
    (next: V) => {
      setView(next)
      writeView(sessionId, next)
    },
    [sessionId],
  )
  return [view, choose]
}

export function ViewTabs<V extends string>({ views, value, onChange }: { views: ViewOption<V>[]; value: V; onChange(view: V): void }) {
  if (views.length < 2) return null
  return (
    <TabList value={value} onChange={(v) => onChange(v as V)} size="sm" hasDivider isFullBleed aria-label="Views">
      {views.map((v) => (
        <Tab key={v.value} value={v.value} label={v.label} />
      ))}
    </TabList>
  )
}
