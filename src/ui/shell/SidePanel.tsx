'use client'

/**
 * The right panel slot of a page: the page content with an optional panel at
 * its end. Closed by default (the page owns `isOpen`). From 768px wide it is a
 * docked column beside the content; below that it is a drawer over the page.
 */
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { Heading } from '@astryxdesign/core/Heading'
import { useMediaQuery } from '@astryxdesign/core/hooks'
import { Layout, LayoutContent, LayoutPanel } from '@astryxdesign/core/Layout'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'

/** Below this width the panel is a drawer (the shell's mobile breakpoint). */
export const NARROW_QUERY = '(max-width: 767.98px)'
const PANEL_WIDTH = 360

const styles = stylex.create({
  frame: { flexGrow: 1, minBlockSize: 0, minInlineSize: 0 },
})

export function SidePanelLayout({
  title,
  isOpen,
  onOpenChange,
  panel,
  children,
}: {
  /** The panel's heading and accessible name. */
  title: string
  isOpen: boolean
  onOpenChange(isOpen: boolean): void
  panel: ReactNode
  children: ReactNode
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  return (
    <>
      <Layout
        xstyle={styles.frame}
        padding={0}
        content={children}
        end={
          isOpen && !narrow ? (
            <LayoutPanel width={PANEL_WIDTH} hasDivider isScrollable label={title} role="complementary" padding={4}>
              <VStack gap={4}>
                <Heading level={2}>{title}</Heading>
                {panel}
              </VStack>
            </LayoutPanel>
          ) : undefined
        }
      />
      {narrow && (
        <Drawer isOpen={isOpen} onOpenChange={onOpenChange} label={title} width={PANEL_WIDTH}>
          <Layout header={<DrawerHeader title={title} onOpenChange={onOpenChange} />} content={<LayoutContent>{panel}</LayoutContent>} />
        </Drawer>
      )}
    </>
  )
}
