'use client'

/**
 * The global Ask Agentry entry: a floating button on every signed-in page (and
 * inside whichever dialog is currently on top) plus a right-side drawer with a
 * real helper chat. On chat pages narrower than 1100px the floating button hides
 * (it would cover the composer). Both it and the sidebar's ✨ icon open the same store, so
 * no route changes while asking.
 */
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Button } from '@astryxdesign/core/Button'
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { HStack } from '@astryxdesign/core/HStack'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import { PlusIcon, SparklesIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { AskAgentryPanel } from '@/ui/chat/AskAgentryPanel'
import { askAgentryStore } from './ask-agentry-store'

const styles = stylex.create({
  // Bottom-right of the page, above the content but below any drawer's scrim.
  floater: {
    position: 'fixed',
    insetBlockEnd: spacingVars['--spacing-6'],
    insetInlineEnd: spacingVars['--spacing-6'],
    zIndex: 20,
    borderRadius: '50%',
    backgroundColor: colorVars['--color-background-surface'],
  },
  // Chat pages have their composer at the bottom: below this width the button
  // would cover its send button, so it hides there (the sidebar ✨ and the
  // shortcut still open the drawer).
  floaterOnChat: {
    display: { default: null, '@media (max-width: 1100px)': 'none' },
  },
  // Inside a dialog: a small icon in its top-right corner, clear of the usual close button.
  dialogActionFloat: {
    position: 'absolute',
    insetBlockStart: spacingVars['--spacing-4'],
    insetInlineEnd: spacingVars['--spacing-12'],
    zIndex: 1,
  },
})

type AskHost = { element: HTMLElement; beside: boolean }

/** A dialog's close button, when it has one: the icon then sits right before it, in the same row. */
function besideClose(dialog: HTMLElement): AskHost | null {
  const close = Array.from(dialog.querySelectorAll<HTMLElement>('button[aria-label]'))
    .find((button) => /^close/i.test(button.getAttribute('aria-label') ?? ''))
  const row = close?.parentElement
  if (!close || !row) return null
  let anchor = row.querySelector<HTMLElement>(':scope > [data-agentry-ask-anchor]')
  if (!anchor) {
    anchor = document.createElement('span')
    anchor.setAttribute('data-agentry-ask-anchor', '')
    anchor.style.display = 'inline-flex'
    anchor.style.alignSelf = 'center'
    row.insertBefore(anchor, close)
  }
  return { element: anchor, beside: true }
}

const SHORTCUT = 'Ask Agentry (Ctrl/⌘+Shift+A)'

/** Where the dialog entry lives, or null on a plain page. Our own drawer is not a host. */
function useDialogHost(): AskHost | null {
  const [host, setHost] = useState<AskHost | null>(null)

  useEffect(() => {
    function update() {
      const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
      const dialog = dialogs.filter((candidate) =>
        candidate.getAttribute('role') !== 'alertdialog' &&
        candidate.getAttribute('data-variant') !== 'fullscreen' &&
        !candidate.hasAttribute('data-agentry-ask-drawer'),
      ).at(-1)
      const next = dialog ? (besideClose(dialog) ?? { element: dialog, beside: false }) : null
      setHost((current) => (current?.element === next?.element && current?.beside === next?.beside ? current : next))
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['open', 'role', 'data-variant'], childList: true, subtree: true })
    update()
    return () => observer.disconnect()
  }, [])

  return host
}

export function AskAgentryLauncher() {
  const { isOpen, sessionId } = askAgentryStore.use()
  const dialogHost = useDialogHost()
  const pathname = usePathname()
  const onChat = pathname === '/' || pathname.startsWith('/c/')
  // The Drawer keeps its children mounted even while closed. Mount the chat only
  // after the first open, so other pages make no model/session requests and a
  // restored helper chat does not open a stream until the user asks for it.
  const [hasOpened, setHasOpened] = useState(false)
  if (isOpen && !hasOpened) setHasOpened(true)

  useEffect(() => {
    // Works while a page dialog has focus (the page FAB itself is behind it).
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        askAgentryStore.open()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const launcher = dialogHost ? (
    <IconButton
      label="Ask Agentry"
      tooltip={SHORTCUT}
      // Accent colour so the helper stands out from the grey close button beside it.
      icon={<Icon icon={SparklesIcon} size="sm" color="accent" />}
      variant="ghost"
      size="sm"
      xstyle={dialogHost.beside ? undefined : styles.dialogActionFloat}
      onClick={askAgentryStore.open}
    />
  ) : (
    <div {...stylex.props(styles.floater, onChat && styles.floaterOnChat)}>
      <IconButton
        label="Ask Agentry"
        tooltip={SHORTCUT}
        icon={<Icon icon={SparklesIcon} size="lg" />}
        variant="primary"
        size="lg"
        width={spacingVars['--spacing-12']}
        elevation="high"
        onClick={askAgentryStore.open}
      />
    </div>
  )

  return (
    <>
      {dialogHost ? createPortal(launcher, dialogHost.element) : launcher}
      <Drawer
        isOpen={isOpen}
        onOpenChange={(open) => (open ? askAgentryStore.open() : askAgentryStore.close())}
        label="Ask Agentry"
        side="end"
        width={460}
        padding={0}
        data-agentry-ask-drawer=""
      >
        {hasOpened && (
          <Layout
            header={
              <DrawerHeader
                title="Ask Agentry"
                onOpenChange={askAgentryStore.close}
                className="ask-agentry-header"
                // Keep the inline (right-edge) compensation off: it bleeds the
                // close button past the panel. The block offsets are reset in
                // globals.css because this header has text buttons too.
                endContentEdgeCompensation="block"
                endContent={
                  <HStack gap={1}>
                    <Button
                      label="New chat"
                      tooltip="Start a new helper chat"
                      icon={<Icon icon={PlusIcon} size="sm" />}
                      size="sm"
                      variant="ghost"
                      onClick={() => askAgentryStore.setSession(null)}
                    />
                    {sessionId && (
                      <Button
                        as={Link}
                        href={`/c/${encodeURIComponent(sessionId)}`}
                        label="Open full chat"
                        size="sm"
                        variant="ghost"
                        onClick={askAgentryStore.close}
                      />
                    )}
                  </HStack>
                }
              />
            }
            content={
              <LayoutContent isScrollable={false}>
                <AskAgentryPanel
                  sessionId={sessionId}
                  onSessionCreated={askAgentryStore.setSession}
                  onNewChat={() => askAgentryStore.setSession(null)}
                />
              </LayoutContent>
            }
          />
        )}
      </Drawer>
    </>
  )
}
