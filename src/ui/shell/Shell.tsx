'use client'

import { AppShell } from '@astryxdesign/core/AppShell'
import type { ReactNode } from 'react'
import { useSkillsLoader } from '@/skills/skills-store'
import { Sidebar } from './Sidebar'
import type { ShellIdentity } from './UserMenu'

/** The signed-in frame: the sidebar (a drawer below 768px) beside the page. */
export function Shell({ identity, children }: { identity: ShellIdentity; children: ReactNode }) {
  useSkillsLoader()
  return (
    <AppShell sideNav={<Sidebar identity={identity} />} variant="elevated" contentPadding={0}>
      {children}
    </AppShell>
  )
}
