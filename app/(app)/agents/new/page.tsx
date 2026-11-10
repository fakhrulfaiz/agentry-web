import { requirePageSession } from '@/server/require-auth'
import { AgentForm } from '@/ui/agents/AgentForm'

export const dynamic = 'force-dynamic'

export default async function NewAgentRoute() {
  await requirePageSession()
  return <AgentForm />
}
