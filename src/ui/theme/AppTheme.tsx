'use client'

import { LinkProvider } from '@astryxdesign/core/Link'
import { Theme } from '@astryxdesign/core/theme'
import NextLink from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import '@astryxdesign/theme-neutral/fonts.css'
import { agentryTheme } from './agentry'
import './agentry.css'
import type { ThemeMode } from './theme-cookie'

/**
 * Next's `Link` that prefetches an in-app page in full. Signed-in pages are
 * dynamic, and Next prefetches nothing for those by default, so each sidebar
 * click used to wait on the server. API routes (downloads, logout) are left
 * alone, since a prefetch would request them.
 */
function AppLink({ href, prefetch, ...rest }: ComponentProps<typeof NextLink>) {
  const path = typeof href === 'string' ? href : (href.pathname ?? '')
  const inApp = path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/api/')
  return <NextLink href={href} prefetch={prefetch ?? (inApp ? true : undefined)} {...rest} />
}

/**
 * Applies the Agentry theme (theme-neutral plus the brand accent, see
 * `brand.ts`) in the mode stored in the `agentry_theme` cookie, and routes
 * astryx links through Next's client-side `Link` (see `AppLink`).
 */
export function AppTheme({ mode = 'system', children }: { mode?: ThemeMode; children: ReactNode }) {
  return (
    <Theme theme={agentryTheme} mode={mode}>
      <LinkProvider component={AppLink}>{children}</LinkProvider>
    </Theme>
  )
}
