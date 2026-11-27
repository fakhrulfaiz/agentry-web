'use client'

/** The pages the agent's browser visited, kept under a collapsed disclosure so the page stays the hero. */
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Link } from '@astryxdesign/core/Link'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { useState } from 'react'
import { shortUrl } from '@/chat/browser-tools'
import { parseAddress } from './browser-address'

export interface BrowserHistoryProps {
  pages: Array<{ url: string; title?: string }>
}

export function BrowserHistory({ pages }: BrowserHistoryProps) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      isOpen={open}
      onOpenChange={setOpen}
      trigger={<Text type="label">Pages visited ({pages.length})</Text>}
    >
      {open && (
        <List aria-label="Pages visited" listStyle="decimal" density="compact">
          {pages.map((p, i) => {
            const label = p.title ? `${p.title} (${shortUrl(p.url)})` : shortUrl(p.url)
            return (
              <ListItem
                key={`${String(i)}:${p.url}`}
                label={parseAddress(p.url).href ? <Link href={p.url} isExternalLink>{label}</Link> : <Text>{label}</Text>}
              />
            )
          })}
        </List>
      )}
    </Collapsible>
  )
}
