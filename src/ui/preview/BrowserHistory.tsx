'use client'

/** The pages the agent's browser visited, kept under a collapsed disclosure so the page stays the hero. */
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { shortUrl } from '@/chat/browser-tools'
import { parseAddress } from './browser-address'

export interface BrowserHistoryProps {
  pages: Array<{ url: string; title?: string }>
}

const styles = stylex.create({
  list: { margin: 0, paddingInlineStart: 20 },
})

export function BrowserHistory({ pages }: BrowserHistoryProps) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      isOpen={open}
      onOpenChange={setOpen}
      trigger={<Text type="label">Pages visited ({pages.length})</Text>}
    >
      {open && (
        <VStack as="ol" gap={1} aria-label="Pages visited" xstyle={styles.list}>
          {pages.map((p, i) => {
            const label = p.title ? `${p.title} (${shortUrl(p.url)})` : shortUrl(p.url)
            return (
              <li key={`${String(i)}:${p.url}`}>
                {parseAddress(p.url).href
                  ? <Link href={p.url} isExternalLink>{label}</Link>
                  : <Text>{label}</Text>}
              </li>
            )
          })}
        </VStack>
      )}
    </Collapsible>
  )
}
