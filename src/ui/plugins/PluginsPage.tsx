'use client'

/**
 * The Plugins page body: Connectors and Skills as top-level tabs. The tab is
 * in the URL (`?tab=connectors|skills`) so a link can open either one; both
 * panels are server-rendered by the route and only the chosen one is shown.
 */
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { pluginsTabOf, type PluginsTab } from './tab'


export function PluginsPage({ tab, connectors, skills }: { tab: PluginsTab; connectors: ReactNode; skills: ReactNode }) {
  const router = useRouter()
  const [current, setCurrent] = useState<PluginsTab>(tab)
  const choose = (value: string) => {
    const next = pluginsTabOf(value)
    setCurrent(next)
    router.replace(`/plugins?tab=${next}`)
  }
  return (
    <VStack gap={5}>
      <TabList value={current} onChange={choose} hasDivider aria-label="Plugins">
        <Tab value="connectors" label="Connectors" />
        <Tab value="skills" label="Skills" />
      </TabList>
      {current === 'connectors' ? connectors : skills}
    </VStack>
  )
}
