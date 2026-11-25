/**
 * A rounded square tinted with an accent hue, holding one icon: the visual
 * identity of an agent, a skill, an environment or an artifact on its card.
 */
import { Icon } from '@astryxdesign/core/Icon'
import type { ComponentType, SVGProps } from 'react'
import { HUES, tint, type HueName } from '@/ui/brand/palette'

export type TileIcon = ComponentType<SVGProps<SVGSVGElement>>

const SIZES = { sm: { box: 28, radius: 7, icon: 'sm' }, md: { box: 40, radius: 10, icon: 'md' }, lg: { box: 56, radius: 14, icon: 'lg' } } as const

export function IconTile({ icon, hue, size = 'md', label }: { icon: TileIcon; hue: HueName; size?: keyof typeof SIZES; label?: string }) {
  const s = SIZES[size]
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        inlineSize: s.box,
        blockSize: s.box,
        flexShrink: 0,
        borderRadius: s.radius,
        display: 'grid',
        placeItems: 'center',
        background: tint(HUES[hue], 16),
        color: HUES[hue],
        boxShadow: `inset 0 0 0 1px ${tint(HUES[hue], 22)}`,
      }}
    >
      <Icon icon={icon} size={s.icon} />
    </span>
  )
}
