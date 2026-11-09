'use client'

import { LinkProvider } from '@astryxdesign/core/Link'
import { Theme } from '@astryxdesign/core/theme'
import NextLink from 'next/link'
import type { ReactNode } from 'react'
import '@astryxdesign/theme-neutral/fonts.css'
import { agentryTheme } from './agentry'
import './agentry.css'
import type { ThemeMode } from './theme-cookie'

/**
 * Applies the Agentry theme (theme-neutral plus the brand accent, see
 * `brand.ts`) in the mode stored in the `agentry_theme` cookie, and routes
 * astryx links through Next's client-side `Link`.
 */
export function AppTheme({ mode = 'system', children }: { mode?: ThemeMode; children: ReactNode }) {
  return (
    <Theme theme={agentryTheme} mode={mode}>
      <LinkProvider component={NextLink}>{children}</LinkProvider>
    </Theme>
  )
}
