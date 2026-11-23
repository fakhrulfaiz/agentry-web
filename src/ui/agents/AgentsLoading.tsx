/**
 * Shown the moment an agent page is opened, while the route renders: the
 * page's outline, so the click answers at once.
 */
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { VStack } from '@astryxdesign/core/VStack'

export function AgentsLoading() {
  return (
    <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto', padding: '24px 16px' }} aria-busy="true" aria-label="Loading">
      <VStack gap={4}>
        <Skeleton width={96} height={16} />
        <Skeleton width={240} height={36} />
        <Skeleton height={160} index={1} />
        <Skeleton height={240} index={2} />
      </VStack>
    </div>
  )
}
