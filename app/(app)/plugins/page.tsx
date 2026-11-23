import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { getCatalog } from '@/server/connector-catalog'
import { getKey, ownerOf } from '@/server/connectors-store'
import { requirePageSession } from '@/server/require-auth'
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
 * directory loads only when the owner has a key, so nothing is sent to a
 * keyless browser.
 */
export default async function Plugins({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { identity } = await requirePageSession()
  const tab = pluginsTabOf((await searchParams).tab)
  const key = await getKey(ownerOf(identity))
  const directory = key ? await loadDirectory() : null
  const connectors = (
    <VStack gap={5}>
      <Text type="supporting" color="secondary">
        Browse the apps your chats can use. Connect starts a chat that sets up your account.
      </Text>
      <ConnectorsForm configured={key !== undefined} />
      {directory}
    </VStack>
  )
  const skills = <SkillsTab />
  return (
    <VStack>
      <TopBar title="Plugins" />
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

async function loadDirectory() {
  const catalog = await getCatalog()
  return <ConnectorDirectory entries={catalog.entries} featured={catalog.featured} failed={catalog.failed} />
}
