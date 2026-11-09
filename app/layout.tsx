import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppTheme } from '@/ui/theme/AppTheme'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agentry',
  description: 'Chat with Agentry agents',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppTheme>{children}</AppTheme>
      </body>
    </html>
  )
}
