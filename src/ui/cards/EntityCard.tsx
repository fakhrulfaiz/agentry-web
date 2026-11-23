'use client'

/**
 * A list entry as a card: the title is the link, stretched over the whole card so
 * a click anywhere opens it, while `trailing` controls (a switch, a menu) sit above
 * it and stay clickable. `footer` carries the entry's facts; `dimmed` quiets
 * entries that are not live (paused, ended).
 */
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: { default: colorVars['--color-background-card'], ':hover': colorVars['--color-overlay-hover'] },
  },
  dimmed: { opacity: 0.7 },
  head: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { flex: 1, minWidth: 0 },
  // The title link's click area covers the whole card.
  stretch: {
    '::after': { content: '""', position: 'absolute', inset: 0, borderRadius: radiusVars['--radius-container'] },
  },
  trailing: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  footer: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, marginTop: 'auto', paddingTop: 4 },
})

export function CardGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} {...stylex.props(styles.grid)}>
      {children}
    </ul>
  )
}

export function EntityCard({
  href,
  title,
  leading,
  trailing,
  children,
  footer,
  dimmed = false,
}: {
  /** Where the card goes; without it the title is plain text (a card that only shows facts). */
  href?: string
  title: string
  /** An icon tile or avatar before the title. */
  leading?: ReactNode
  trailing?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  dimmed?: boolean
}) {
  return (
    <li {...stylex.props(styles.card, dimmed && styles.dimmed)}>
      <div {...stylex.props(styles.head)}>
        {leading}
        <div {...stylex.props(styles.title)}>
          {href === undefined ? (
            <Text weight="medium" maxLines={1}>{title}</Text>
          ) : (
            <Link href={href}>
              <span {...stylex.props(styles.stretch)}>
                <Text weight="medium" maxLines={1}>{title}</Text>
              </span>
            </Link>
          )}
        </div>
        {trailing && <div {...stylex.props(styles.trailing)}>{trailing}</div>}
      </div>
      {children}
      {footer && <div {...stylex.props(styles.footer)}>{footer}</div>}
    </li>
  )
}

/** One small fact in a card footer: an icon and a short value. */
export function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {icon}
      <Text type="supporting" color="secondary">{children}</Text>
    </span>
  )
}
