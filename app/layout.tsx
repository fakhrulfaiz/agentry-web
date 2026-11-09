import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { AppTheme } from '@/ui/theme/AppTheme'
import { parseThemeMode, THEME_COOKIE } from '@/ui/theme/theme-cookie'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agentry',
  description: 'Chat with Agentry agents',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const mode = parseThemeMode((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="en">
      <body>
        <AppTheme mode={mode}>{children}</AppTheme>
      </body>
    </html>
  )
}
