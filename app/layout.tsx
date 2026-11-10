import type { Metadata } from 'next'
import { Inter, Source_Serif_4 } from 'next/font/google'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { AppTheme } from '@/ui/theme/AppTheme'
import { parseThemeMode, THEME_COOKIE } from '@/ui/theme/theme-cookie'
import './globals.css'

/** Free stand-ins for a claude.ai-like look: a neutral sans for text, a book serif for headings. */
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })

export const metadata: Metadata = {
  title: 'Agentry',
  description: 'Chat with Agentry agents',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const mode = parseThemeMode((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <AppTheme mode={mode}>{children}</AppTheme>
      </body>
    </html>
  )
}
