'use client'

/**
 * The panel's Browser tab: a live view of the agent's browser while it is open (frames from the API's
 * live route), else the latest screenshot from the browser tool results. A browser-like toolbar shows
 * the current address and state above a fixed viewport; "Take control" lets the user use that page
 * with mouse and keyboard (the agent's browser waits) until they hand it back. Esc leaves the frame
 * without being sent. When the chat cannot browse, it says why. `BrowserAutoOpen` opens the tab when
 * a browser call starts while the chat is open.
 */
import { Dialog } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import { artifactUrl } from '@/artifacts/kind'
import { fileContentPath } from '@/chat/attachments'
import { usePanelConversation } from '@/chat/panel-data'
import { useBrowserLive, type BrowserIdleReason } from '@/chat/use-browser-live'
import { useBrowserControl, type ControlEndReason } from '@/chat/browser-input'
import { usePreviewPanel } from '@/preview/store'
import { parseAddress } from './browser-address'
import { BrowserHistory } from './BrowserHistory'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserViewport } from './BrowserViewport'

export const BROWSER_VIEW = 'browser'
export const BROWSER_TITLE = 'Browser'

/** What the user is told when control went back to the agent without them handing it back. */
const ENDED: Partial<Record<ControlEndReason, string>> = {
  idle: 'Control went back to the agent after 5 minutes without input.',
  left: 'Control went back to the agent when you left the chat.',
  taken: 'You took control in another tab.',
  closed: 'Control ended because the browser view closed.',
}

/** Why the chat cannot browse, for the reasons that need the user to change something. */
export const CANNOT_BROWSE: Partial<Record<BrowserIdleReason, { title: string; description: string }>> = {
  not_sandbox: { title: 'Only chats on a sandbox can use a browser', description: 'This chat runs on the server. Start a chat on a sandbox to let the agent browse.' },
  no_browser: { title: 'This sandbox has no browser', description: 'Its image has no browser. Start a new chat on a sandbox made from the Web and browser template.' },
  browser_off: { title: 'The web browser is off for this agent', description: 'Turn on Web browser in the agent\'s Tools.' },
}

const styles = stylex.create({
  // The tab fills the panel's page: the viewport takes what the toolbar and the notes leave.
  tab: { flexGrow: 1, minBlockSize: 0, blockSize: '100%' },
  notes: { flexShrink: 0 },
  fillNote: { flexGrow: 1, minBlockSize: 0 },
  expanded: { inlineSize: '100%', blockSize: `calc(100dvh - ${spacingVars['--spacing-12']} * 2)`, minBlockSize: 0 },
})

export function BrowserTab({ sessionId = null }: { sessionId?: string | null }) {
  const { browser } = usePanelConversation()
  const [expanded, setExpanded] = useState(false)
  const live = useBrowserLive(sessionId)
  const { control, take, handBack, send } = useBrowserControl(sessionId, live.control)
  const blocked = live.status === 'idle' ? CANNOT_BROWSE[live.reason] : undefined
  if (browser.calls === 0 && live.status !== 'live') {
    if (blocked) return <EmptyState title={blocked.title} description={blocked.description} headingLevel={2} />
    return <EmptyState title="No browsing yet" description="When the agent uses its web browser, you can watch it here, with the pages it visited." headingLevel={2} />
  }
  const isLive = live.status === 'live'
  const current = isLive && live.frame.url ? live.frame : browser.current
  const statusText =
    control.status === 'on' ? 'You have control' :
    control.status === 'held' ? 'You have control in another tab' :
    control.status === 'taking' ? 'Taking control' :
    isLive ? 'Live' : 'Not browsing'
  const toolbar = (onExpand: (() => void) | undefined, onCollapse: (() => void) | undefined) => (
    <BrowserToolbar
      address={current ? parseAddress(current.url) : null}
      title={current?.title}
      statusText={statusText}
      isLive={isLive}
      running={browser.running}
      controlStatus={control.status}
      onTake={() => void take(control.status === 'held')}
      onHandBack={handBack}
      onExpand={onExpand}
      onCollapse={onCollapse}
    />
  )
  const viewport = (
    <BrowserViewport
      frame={isLive ? live.frame : null}
      screenshotUrl={browser.screenshot?.file_id ? artifactUrl({ content_url: fileContentPath(browser.screenshot.file_id) }) : null}
      inControl={isLive && control.status === 'on'}
      send={send}
      pointer={isLive ? live.pointer : undefined}
      focus={isLive ? live.focus : undefined}
    />
  )
  return (
    <VStack gap={3} data-testid="browser-tab" xstyle={styles.tab}>
      {toolbar(() => { setExpanded(true) }, undefined)}
      {expanded ? (
        // One viewport at a time, so input mapping and the page size follow the element actually shown.
        <VStack data-testid="browser-viewport-expanded-note" xstyle={styles.fillNote}>
          <Text type="supporting" color="secondary">The browser is open in the expanded view.</Text>
        </VStack>
      ) : viewport}
      <Dialog isOpen={expanded} onOpenChange={setExpanded} variant="fullscreen" purpose="required" width="100%">
        {expanded && (
          <VStack gap={3} data-testid="browser-expanded" xstyle={styles.expanded}>
            {toolbar(undefined, () => { setExpanded(false) })}
            {viewport}
          </VStack>
        )}
      </Dialog>
      <VStack gap={3} xstyle={styles.notes}>
        {blocked && <Text type="supporting" color="secondary">{blocked.title}. {blocked.description}</Text>}
        {control.status === 'on' && (
          <Text type="supporting" color="secondary">The agent waits until you hand the browser back. Esc leaves the page view; control returns to the agent after 5 minutes without input.</Text>
        )}
        {control.status === 'held' && <Text type="supporting" color="secondary">Take control here to use the page. The other tab hands it back when you do.</Text>}
        {control.status === 'off' && (control.error || (control.ended && ENDED[control.ended])) && (
          <Text type="supporting" color="secondary">{control.error ?? ENDED[control.ended!]}</Text>
        )}
        {control.status !== 'on' && <Text type="supporting" color="secondary">You are watching the agent's browser. Take control to click and type in it yourself; the agent waits until you hand it back.</Text>}
        {browser.visited.length > 0 && <BrowserHistory pages={browser.visited} />}
      </VStack>
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
