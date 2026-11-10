import { requirePageSession } from '@/server/require-auth'
import { AgentForm } from '@/ui/agents/AgentForm'

export const dynamic = 'force-dynamic'

export default async function EditAgentRoute({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession()
  const { id } = await params
  return <AgentForm agentId={id} />
}
