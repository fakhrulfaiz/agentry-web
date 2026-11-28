'use client'

/** A connected-app sign-in request from a tool call, as a Connect button instead of a raw link. */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { Icon } from '@astryxdesign/core/Icon'
import { ArrowUpRightIcon, CheckCircleIcon } from '@heroicons/react/16/solid'
import { useEffect, useState } from 'react'
import type { ConnectRequest } from '@/api/types'
import { fetchStatus } from '@/connectors/status'
import { AppLogo } from '@/ui/shared/AppLogo'

const POLL_MS = 5_000
const POLL_FOR_MS = 10 * 60_000

/** One status request at a time for every Connect card on the page (a chat can hold several). */
let shared: { at: number; refresh: boolean; result: Promise<string[] | null> } | null = null
function connectedApps(refresh: boolean): Promise<string[] | null> {
  if (shared && Date.now() - shared.at < POLL_MS - 500 && (shared.refresh || !refresh)) return shared.result
  const result = fetchStatus(refresh).then((status) => status?.connected ?? null).catch(() => null)
  shared = { at: Date.now(), refresh, result }
  return result
}

/**
 * Whether `toolkit` is connected: read once, then (while not) re-checked every few seconds while the tab is
 * visible, for up to ten minutes, so the card turns into "connected" soon after the user finishes signing in.
 */
function useConnected(toolkit: string | null): boolean {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!toolkit) return
    const app = toolkit.toLowerCase()
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const check = async (refresh: boolean) => {
      const apps = await connectedApps(refresh)
      if (!alive) return
      if (apps?.includes(app)) return setConnected(true)
      if (Date.now() - started < POLL_FOR_MS) timer = setTimeout(() => void tick(), POLL_MS)
    }
    const tick = async () => {
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(() => void tick(), POLL_MS)
        return
      }
      await check(true)
    }
    void check(false)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [toolkit])
  return connected
}

/** `gmail` → `Gmail`; unknown apps are "app". */
const NAMES: Record<string, string> = { googlecalendar: 'Google Calendar', googledrive: 'Google Drive', googledocs: 'Google Docs', googlesheets: 'Google Sheets' }
export const appLabel = (toolkit: string | null): string => (toolkit ? (NAMES[toolkit.toLowerCase()] ?? toolkit.charAt(0).toUpperCase() + toolkit.slice(1)) : 'app')

export function ConnectCard({ request }: { request: ConnectRequest }) {
  const connected = useConnected(request.toolkit)
  if (connected) {
    return (
      <HStack gap={2} vAlign="center" paddingBlock={1}>
        {request.toolkit && <AppLogo slug={request.toolkit} name={appLabel(request.toolkit)} size={16} />}
        <Text type="supporting" color="secondary">{appLabel(request.toolkit)} connected</Text>
        <Icon icon={CheckCircleIcon} size="sm" color="success" />
      </HStack>
    )
  }
  return (
    // Wraps in a narrow column (the Ask Agentry drawer) so the button keeps its full label.
    <HStack gap={3} vAlign="center" paddingBlock={2} wrap="wrap">
      {request.toolkit && <AppLogo slug={request.toolkit} name={appLabel(request.toolkit)} size={24} />}
      <Button label={`Connect ${appLabel(request.toolkit)}`} variant="primary" size="sm" href={request.url} target="_blank" rel="noopener noreferrer" endContent={<ArrowUpRightIcon width={16} height={16} aria-hidden />} />
      <Text type="supporting" color="secondary">Sign in opens in a new tab. Come back here when you are done.</Text>
    </HStack>
  )
}

/** A failed call for an app that is not connected: a link to the connectors page, where the user can connect it. */
export function ConnectSettingsLink({ toolkit }: { toolkit: string }) {
  return (
    <HStack gap={3} vAlign="center" paddingBlock={2} wrap="wrap">
      <AppLogo slug={toolkit} name={appLabel(toolkit)} size={24} />
      <Button label={`Connect ${appLabel(toolkit)}`} variant="primary" size="sm" href="/settings/connectors" endContent={<ArrowUpRightIcon width={16} height={16} aria-hidden />} />
      <Text type="supporting" color="secondary">{appLabel(toolkit)} is not connected yet. Connect it in Settings, then ask again.</Text>
    </HStack>
  )
}
