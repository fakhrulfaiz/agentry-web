import { requirePageSession } from '@/server/require-auth'
import { EnvironmentDetail } from '@/ui/sandboxes/EnvironmentDetail'

export const dynamic = 'force-dynamic'

export default async function EnvironmentRoute({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession()
  const { id } = await params
  return <EnvironmentDetail environmentId={id} />
}
