import { requirePageSession } from '@/server/require-auth'
import { ScheduledPage } from '@/ui/scheduled/ScheduledPage'

export const dynamic = 'force-dynamic'

export default async function ScheduledTasksPage() {
  await requirePageSession()
  return <ScheduledPage />
}
