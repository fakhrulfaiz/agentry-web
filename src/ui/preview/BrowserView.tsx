'use client'

/**
 * The panel's Browser tab: a live, read-only view of the agent's browser while it is open (frames from
 * the API's live route), else the latest screenshot from the browser tool results, plus the page it is
 * on and the pages it visited. When the chat cannot browse, it says why. `BrowserAutoOpen` opens the tab
 * when a browser call starts while the chat is open.
 */
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
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
import { useBrowserLive, type BrowserIdleReason } from '@/chat/use-browser-live'
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

/** Why the chat cannot browse, for the reasons that need the user to change something. */
export const CANNOT_BROWSE: Partial<Record<BrowserIdleReason, { title: string; description: string }>> = {
  not_sandbox: { title: 'Only chats on a sandbox can use a browser', description: 'This chat runs on the server. Start a chat on a sandbox environment to let the agent browse.' },
  no_browser: { title: 'This sandbox has no browser', description: 'Create the environment from the Web and browser template, or reset it from one.' },
  browser_off: { title: 'The web browser is off for this agent', description: 'Turn on Web browser in the agent\'s Tools.' },
}

export function BrowserTab({ sessionId = null }: { sessionId?: string | null }) {
  const { browser } = usePanelConversation()
  const live = useBrowserLive(sessionId)
  const blocked = live.status === 'idle' ? CANNOT_BROWSE[live.reason] : undefined
  if (browser.calls === 0 && live.status !== 'live') {
    if (blocked) return <EmptyState title={blocked.title} description={blocked.description} headingLevel={2} />
    return <EmptyState title="No browsing yet" description="When the agent uses its web browser, you can watch it here, with the pages it visited." headingLevel={2} />
  }
  const isLive = live.status === 'live'
  const current = isLive && live.frame.url ? { url: live.frame.url, ...(live.frame.title ? { title: live.frame.title } : {}) } : browser.current
  return (
    <VStack gap={4} data-testid="browser-tab">
      <HStack gap={2} vAlign="center">
        <Icon icon={GlobeAltIcon} color="secondary" size="sm" />
        <StackItem size="fill">
          {current ? <Page {...current} /> : <Text color="secondary">No page open yet</Text>}
        </StackItem>
        {browser.running && <Spinner size="sm" aria-label="The browser is working" />}
        <HStack gap={1} vAlign="center">
          <StatusDot variant={isLive ? 'success' : 'neutral'} label={isLive ? 'Live' : 'Not browsing'} isPulsing={isLive} />
          <Text type="supporting" color="secondary">{isLive ? 'Live' : 'Not browsing'}</Text>
        </HStack>
      </HStack>
      {blocked && <Text type="supporting" color="secondary">{blocked.title}. {blocked.description}</Text>}
      {isLive ? (
        // eslint-disable-next-line @next/next/no-img-element -- streamed frames (data URLs); next/image does not apply
        <img src={live.frame.src} alt="Live view of the agent's browser" {...stylex.props(styles.shot)} />
      ) : browser.screenshot?.file_id ? (
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
      <Text type="supporting" color="secondary">Read-only: you can watch the agent's browser here, not control it.</Text>
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
