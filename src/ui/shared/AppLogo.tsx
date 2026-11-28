'use client'

/** A connected app's logo (Composio's logo host), decorative; falls back to a letter avatar when it fails to load. */
import { Avatar } from '@astryxdesign/core/Avatar'
import { useState } from 'react'
import { logoUrl } from '@/connectors/catalog'

export function AppLogo({ slug, name, size = 20 }: { slug: string; name: string; size?: 16 | 20 | 24 | 32 }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Avatar name={name} size={size} tooltip={false} />
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external logo host; next/image does not apply
    <img
      src={logoUrl(slug)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ flex: 'none', objectFit: 'contain' }}
    />
  )
}
