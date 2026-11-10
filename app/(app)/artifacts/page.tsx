import { requirePageSession } from '@/server/require-auth'
import { ArtifactsPage } from '@/ui/artifacts/ArtifactsPage'

export const dynamic = 'force-dynamic'

export default async function ArtifactsRoute() {
  await requirePageSession()
  return <ArtifactsPage />
}
