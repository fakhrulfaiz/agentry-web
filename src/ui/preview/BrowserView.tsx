'use client'

/**
 * The panel's Browser tab: a live view of the agent's browser while it is open (frames from the API's
 * live route), else the latest screenshot from the browser tool results, plus the page it is on and the
 * pages it visited. "Take control" lets the user use the page with mouse and keyboard (the agent's
 * browser waits) until they hand it back; Esc leaves the frame without being sent. When the chat cannot browse, it says why. `BrowserAutoOpen` opens the tab
 * when a browser call starts while the chat is open.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { GlobeAltIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef } from 'react'
import { artifactUrl } from '@/artifacts/kind'
import { fileContentPath } from '@/chat/attachments'
import { shortUrl } from '@/chat/browser-tools'
import { usePanelConversation } from '@/chat/panel-data'
import { useBrowserLive, type BrowserIdleReason } from '@/chat/use-browser-live'
import { useBrowserControl, type ControlEndReason } from '@/chat/browser-input'
import { usePreviewPanel } from '@/preview/store'
import { BrowserViewport } from './BrowserViewport'

export const BROWSER_VIEW = 'browser'
export const BROWSER_TITLE = 'Browser'

const styles = stylex.create({
  list: { margin: 0, paddingInlineStart: 20 },
})

/** What the user is told when control went back to the agent without them handing it back. */
const ENDED: Partial<Record<ControlEndReason, string>> = {
  idle: 'Control went back to the agent after 5 minutes without input.',
  left: 'Control went back to the agent when you left the chat.',
  taken: 'You took control in another tab.',
  closed: 'Control ended because the browser view closed.',
}

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
  no_browser: { title: 'This sandbox has no browser', description: 'Its image has no browser. Start a new chat on an environment made from the Web and browser template.' },
  browser_off: { title: 'The web browser is off for this agent', description: 'Turn on Web browser in the agent\'s Tools.' },
}

export function BrowserTab({ sessionId = null }: { sessionId?: string | null }) {
  const { browser } = usePanelConversation()
  const live = useBrowserLive(sessionId)
  const { control, take, handBack, send } = useBrowserControl(sessionId, live.control)
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
      {control.status === 'on' && (
        <Banner
          status="info"
          title="You have control"
          description="The agent waits until you hand the browser back. Esc leaves the page view; control returns to the agent after 5 minutes without input."
          collapsible={false}
          endContent={<Button label="Hand back" size="sm" variant="primary" onClick={handBack} />}
        />
      )}
      {control.status === 'held' && (
        <Banner
          status="warning"
          title="You have control in another tab"
          collapsible={false}
          endContent={<Button label="Take control here" size="sm" onClick={() => void take(true)} />}
        />
      )}
      {isLive && (control.status === 'off' || control.status === 'taking') && (
        <HStack gap={2} vAlign="center">
          <Button label="Take control" size="sm" isDisabled={control.status === 'taking'} onClick={() => void take()} />
          {control.status === 'off' && (control.error || (control.ended && ENDED[control.ended])) && (
            <Text type="supporting" color="secondary">{control.error ?? ENDED[control.ended!]}</Text>
          )}
        </HStack>
      )}
      <BrowserViewport
        frame={isLive ? live.frame : null}
        screenshotUrl={browser.screenshot?.file_id ? artifactUrl({ content_url: fileContentPath(browser.screenshot.file_id) }) : null}
        inControl={control.status === 'on'}
        send={send}
      />
      {browser.visited.length > 0 && (
        <VStack gap={2}>
          <Text type="label">Pages visited</Text>
          <ol {...stylex.props(styles.list)} aria-label="Pages visited">
            {browser.visited.map((p, i) => <li key={`${String(i)}:${p.url}`}><Page {...p} /></li>)}
          </ol>
        </VStack>
      )}
      {control.status !== 'on' && <Text type="supporting" color="secondary">You are watching the agent's browser. Take control to click and type in it yourself; the agent waits until you hand it back.</Text>}
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
