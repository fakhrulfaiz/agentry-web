'use client'

/** A sidebar section's header that folds the section, as claude.ai's "Recents ⌄": the whole row is the toggle, the chevron sits right after the label. */
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    inlineSize: '100%',
    paddingBlock: 4,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
})

export function SectionHeader({ label, isOpen, onToggle }: { label: string; isOpen: boolean; onToggle(): void }) {
  return (
    <button type="button" aria-expanded={isOpen} onClick={onToggle} {...stylex.props(styles.row)}>
      <Text type="supporting" color="secondary" weight="medium">{label}</Text>
      <Icon icon={isOpen ? ChevronDownIcon : ChevronRightIcon} size="xsm" color="secondary" />
    </button>
  )
}
