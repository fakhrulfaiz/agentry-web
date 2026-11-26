'use client'

/**
 * The panel's Browser tab: the page the agent's browser is on, its latest screenshot and the pages it
 * visited, from the browser tool results (read-only). `BrowserAutoOpen` opens the tab when a browser
 * call starts while the chat is open.
 */
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef } from 'react'
import { artifactUrl } from '@/artifacts/kind'
import { fileContentPath } from '@/chat/attachments'
import { shortUrl } from '@/chat/browser-tools'
import { usePanelConversation } from '@/chat/panel-data'
import { usePreviewPanel } from '@/preview/store'

export const BROWSER_VIEW = 'browser'
export const BROWSER_TITLE = 'Browser'

const styles = stylex.create({
  shot: {
    display: 'block',
    inlineSize: '100%',
    blockSize: 'auto',
    borderRadius: radiusVars['--radius-container'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
  },
  list: { margin: 0, paddingInlineStart: 20 },
})

/** Only web addresses become links; anything else (about:blank, data:) stays text. */
function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function Page({ url, title }: { url: string; title?: string }) {
  const label = title ? `${title} (${shortUrl(url)})` : shortUrl(url)
  return isWeb(url) ? <Link href={url} isExternalLink>{label}</Link> : <Text>{label}</Text>
}

export function BrowserTab() {
  const { browser } = usePanelConversation()
  if (browser.calls === 0) {
    return <EmptyState title="No browsing yet" description="When the agent uses its web browser, the page it is on and its latest screenshot appear here." headingLevel={2} />
  }
  return (
    <VStack gap={4} data-testid="browser-tab">
      <HStack gap={2} vAlign="center">
        <Icon icon={GlobeAltIcon} color="secondary" size="sm" />
        <StackItem size="fill">
          {browser.current ? <Page {...browser.current} /> : <Text color="secondary">No page open yet</Text>}
        </StackItem>
        {browser.running && <Spinner size="sm" aria-label="The browser is working" />}
      </HStack>
      {browser.screenshot?.file_id ? (
        // eslint-disable-next-line @next/next/no-img-element -- BFF bytes; next/image does not apply
        <img src={artifactUrl({ content_url: fileContentPath(browser.screenshot.file_id) })} alt="Latest screenshot of the agent's browser" {...stylex.props(styles.shot)} />
      ) : (
        <Text type="supporting" color="secondary">No screenshot yet. The agent mostly reads pages as text; it takes a screenshot when the layout matters or you ask for one.</Text>
      )}
      {browser.visited.length > 0 && (
        <VStack gap={2}>
          <Text type="label">Pages visited</Text>
          <ol {...stylex.props(styles.list)} aria-label="Pages visited">
            {browser.visited.map((p, i) => <li key={`${String(i)}:${p.url}`}><Page {...p} /></li>)}
          </ol>
        </VStack>
      )}
      <Text type="supporting" color="secondary">Read-only: this shows what the agent saw, not a live window.</Text>
    </VStack>
  )
}

/** Opens the Browser tab when the chat makes a new browser call (not for calls already in the history, which counts once `loaded`). */
export function BrowserAutoOpen({ loaded }: { loaded: boolean }) {
  const { browser } = usePanelConversation()
  const { actions } = usePreviewPanel()
  const seen = useRef<number | null>(null)
  useEffect(() => {
    // The first count is the loaded history; only calls after it open the tab.
    if (!loaded) return
    if (seen.current === null) {
      seen.current = browser.calls
      return
    }
    if (browser.calls > seen.current) actions.openView(BROWSER_VIEW, BROWSER_TITLE)
    seen.current = browser.calls
  }, [browser.calls, actions, loaded])
  return null
}
