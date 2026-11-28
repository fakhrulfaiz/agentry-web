'use client'

/**
 * "Recent files" under the new-chat composer, as claude.ai shows recent artifacts:
 * the newest files the agent delivered across the user's latest chats. Each opens
 * its chat with the file in the preview panel. A failed load shows nothing.
 */
import { Icon } from '@astryxdesign/core/Icon'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { DocumentIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { deliverableEntries } from '@/artifacts/artifact'
import { sessionTitle } from '@/ui/shell/group'

const CHATS = 6
const SHOWN = 4

const styles = stylex.create({
  row: {
    display: 'grid',
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))' },
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    padding: '10px 12px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  text: { minWidth: 0, display: 'flex', flexDirection: 'column' },
})

interface Recent {
  sessionId: string
  path: string
  title: string
  at: string
}

export function RecentFiles() {
  const [items, setItems] = useState<Recent[]>([])
  useEffect(() => {
    let alive = true
    ;(async () => {
      const sessions = (await api.listSessions({ limit: CHATS })).data
      const lists = await Promise.allSettled(sessions.map((s) => api.listSessionDeliverables(s.id)))
      const found = lists.flatMap((result, i) =>
        result.status === 'fulfilled'
          ? deliverableEntries(result.value).map((entry) => ({
              sessionId: sessions[i].id,
              path: entry.path,
              title: sessionTitle(sessions[i]) || 'Chat',
              at: entry.last_modified ?? '',
            }))
          : [],
      )
      found.sort((a, b) => (a.at < b.at ? 1 : -1))
      // A file delivered again (a new version) is one entry per delivery: show it once, newest first.
      const seen = new Set<string>()
      const unique = found.filter((item) => {
        const key = `${item.sessionId}:${item.path}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (alive) setItems(unique.slice(0, SHOWN))
    })().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  if (items.length === 0) return null
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">Recent files</Text>
      <ul aria-label="Recent files" {...stylex.props(styles.row)}>
        {items.map((item) => (
          <li key={`${item.sessionId}:${item.path}`} {...stylex.props(styles.item)}>
            <Icon icon={DocumentIcon} size="md" color="secondary" />
            <div {...stylex.props(styles.text)}>
              <Link href={`/c/${encodeURIComponent(item.sessionId)}?file=${encodeURIComponent(item.path)}`}>
                <Text weight="medium" maxLines={1}>{item.path.split('/').pop()}</Text>
              </Link>
              <Text type="supporting" color="secondary" maxLines={1}>{item.title}</Text>
            </div>
          </li>
        ))}
      </ul>
    </VStack>
  )
}
