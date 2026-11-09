'use client'

import { Theme } from '@astryxdesign/core/theme'
import type { ReactNode } from 'react'
import { defaultThemeSlug, themes } from '../../astryx-themes'

/** Applies the astryx theme (theme-neutral) to the app; follows the OS light/dark preference. */
export function AppTheme({ children }: { children: ReactNode }) {
  return <Theme theme={themes[defaultThemeSlug]}>{children}</Theme>
}
