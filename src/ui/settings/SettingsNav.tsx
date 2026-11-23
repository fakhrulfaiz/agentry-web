'use client'

import { HStack } from '@astryxdesign/core/HStack'
import { Button } from '@astryxdesign/core/Button'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  { href: '/settings', label: 'General' },
]

/** Section links shared by the settings pages; the current page is marked. */
export function SettingsNav() {
  const pathname = usePathname()
  return (
    <HStack gap={2} paddingInline={4} as="nav" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <Button key={s.href} href={s.href} label={s.label} variant={pathname === s.href ? 'secondary' : 'ghost'} aria-current={pathname === s.href ? 'page' : undefined} />
      ))}
    </HStack>
  )
}
