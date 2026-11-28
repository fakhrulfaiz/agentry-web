'use client'

import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'

const PAGE = 100
const MAX_PAGES = 3

/** The environment id a chat runs in, when it has one. */
export const sessionEnvironmentId = (s: OAIAgentSession): string | null => {
  const id = s.environment?.environment_id
  return typeof id === 'string' ? id : null
}

/**
 * Chats grouped by the environment they run in, counted client-side from the
 * first pages of the chat list (newest first). `null` while loading or when the
 * list cannot be read.
 */
export function useEnvironmentChats(refreshKey: unknown = null): Map<string, OAIAgentSession[]> | null {
  const [byEnv, setByEnv] = useState<Map<string, OAIAgentSession[]> | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const map = new Map<string, OAIAgentSession[]>()
        let after: string | undefined
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const res = await api.listSessions({ limit: PAGE, ...(after ? { after } : {}) })
          for (const s of res.data) {
            const id = sessionEnvironmentId(s)
            if (id) map.set(id, [...(map.get(id) ?? []), s])
          }
          if (!res.has_more || !res.last_id) break
          after = res.last_id
        }
        if (!cancelled) setByEnv(map)
      } catch {
        if (!cancelled) setByEnv(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])
  return byEnv
}
