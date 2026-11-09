import type { ReactNode } from 'react'
import { requirePageSession } from '@/server/require-auth'
import { Shell } from '@/ui/shell/Shell'

// Reads the session cookie on every request; signed-out visits go to /login.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { identity, csrf } = await requirePageSession()
  return (
    <>
      {/* The API client reads this token and sends it as `x-agentry-csrf`; it is not a credential. */}
      <meta name="agentry-csrf" content={csrf} />
      <Shell identity={identity}>{children}</Shell>
    </>
  )
}
