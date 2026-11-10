import { requirePageSession } from '@/server/require-auth'
import { ScheduleDetail } from '@/ui/scheduled/ScheduleDetail'

export const dynamic = 'force-dynamic'

export default async function ScheduleTaskEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession()
  const { id } = await params
  return <ScheduleDetail id={id} initialEdit />
}
