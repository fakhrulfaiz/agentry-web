import { requirePageSession } from '@/server/require-auth'
import { AgentsPage } from '@/ui/agents/AgentsPage'

export const dynamic = 'force-dynamic'

export default async function AgentsRoute() {
  await requirePageSession()
  return <AgentsPage />
}
