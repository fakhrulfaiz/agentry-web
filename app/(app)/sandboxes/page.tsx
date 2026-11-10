import { requirePageSession } from '@/server/require-auth'
import { SandboxesPage } from '@/ui/sandboxes/SandboxesPage'

export const dynamic = 'force-dynamic'

export default async function SandboxesRoute() {
  await requirePageSession()
  return <SandboxesPage />
}
