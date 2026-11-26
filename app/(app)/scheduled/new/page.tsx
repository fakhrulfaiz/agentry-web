import { requirePageSession } from '@/server/require-auth'
import { NewSchedule } from '@/ui/scheduled/NewSchedule'

export const dynamic = 'force-dynamic'

export default async function NewScheduledTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>
}) {
  await requirePageSession()
  const { template } = await searchParams
  return <NewSchedule templateId={template} />
}
