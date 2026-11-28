import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { getCatalog } from '@/server/connector-catalog'
import { connectedSlugs } from '@/server/connector-inventory'
import { ConnectorKeyError, currentKeyStatus, type ConnectorKeyStatus } from '@/server/connector-key-upstream'
import { cacheOwner, connectionSnapshot, connections, keyStamp } from '@/server/connections'
import { ownerOf } from '@/server/connectors-store'
import type { ConnectionStatus } from '@/connectors/status'
import { pageAuthorization, requirePageSession } from '@/server/require-auth'
import { getSession } from '@/server/session'
import { PluginsPage } from '@/ui/plugins/PluginsPage'
import { SkillsTab } from '@/ui/plugins/SkillsTab'
import { pluginsTabOf } from '@/ui/plugins/tab'
import { ConnectorDirectory } from '@/ui/settings/ConnectorDirectory'
import { ConnectorsForm } from '@/ui/settings/ConnectorsForm'
import { TopBar } from '@/ui/shell/TopBar'

export const dynamic = 'force-dynamic'

/** Width of the page column, matching the Artifacts page. */
const COLUMN_WIDTH = 880

/**
 * Plugins: the apps (Connectors) and skills agents can use. The connector
 * directory loads only when the owner has a key (held by the Agentry API), so
 * nothing is sent to a keyless browser.
 */
export default async function Plugins({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { identity } = await requirePageSession()
  const tab = pluginsTabOf((await searchParams).tab)
  const authorization = await pageAuthorization()
  // The key lives in the API; a key left in the old file store moves there on this read.
  let status: ConnectorKeyStatus | null = null
  let disabled = false
  if (authorization) {
    try {
      status = await currentKeyStatus(ownerOf(identity), authorization)
    } catch (error) {
      disabled = error instanceof ConnectorKeyError && error.code === 'secrets_disabled'
    }
  }
  const owner = cacheOwner(await getSession())
  const directory = status?.configured && authorization ? await loadDirectory(knownStatus(owner, keyStamp(status), authorization)) : null
  const connectors = (
    <VStack gap={5}>
      <Text type="supporting" color="secondary">
        Browse the apps your chats can use. Connect starts a chat that sets up your account.
      </Text>
      <ConnectorsForm configured={status?.configured === true} last4={status?.last4 ?? null} disabled={disabled} />
      {directory}
    </VStack>
  )
  const skills = <SkillsTab />
  return (
    <VStack>
      <TopBar />
      <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
        <VStack gap={5}>
          <Heading level={1} type="display-2">
            Plugins
          </Heading>
          <PluginsPage tab={tab} connectors={connectors} skills={skills} />
        </VStack>
      </div>
    </VStack>
  )
}

/**
 * What the server already knows about the owner's connections, without waiting
 * on Composio. When nothing is known yet the check starts now, so the browser's
 * own request joins it instead of starting another.
 */
function knownStatus(owner: string, stamp: string, authorization: string): ConnectionStatus | undefined {
  const snap = connections.peek(owner, stamp)
  if (!snap || (snap.inventory === null && !snap.problem)) {
    void connectionSnapshot(owner, stamp, authorization).catch(() => {})
    return undefined
  }
  return { connected: snap.inventory ? connectedSlugs(snap.inventory) : null, checkedAt: snap.checkedAt, stale: snap.stale, ...(snap.problem ? { problem: snap.problem } : {}) }
}

async function loadDirectory(initialStatus: ConnectionStatus | undefined) {
  const catalog = await getCatalog()
  return <ConnectorDirectory entries={catalog.entries} featured={catalog.featured} failed={catalog.failed} initialStatus={initialStatus} />
}
