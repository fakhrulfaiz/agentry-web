'use client'

/** The Browser tab's one-row browser chrome: security, address, state and control. */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import type { BrowserControl } from '@/chat/browser-input'
import type { BrowserAddress } from './browser-address'

export interface BrowserToolbarProps {
  address: BrowserAddress | null
  /** The page title, kept as a tooltip so it never pushes the URL off the row. */
  title?: string
  statusText: string
  isLive: boolean
  running: boolean
  controlStatus: BrowserControl['status']
  onTake: () => void
  onHandBack: () => void
  /** Opens the live view large. */
  onExpand?: () => void
  /** Closes the large view (shown instead of Expand). */
  onCollapse?: () => void
}

const styles = stylex.create({
  row: { minWidth: 0 },
  field: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    borderRadius: radiusVars['--radius-container'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  host: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rest: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})

/** A single fixed-height toolbar; address ellipsizes, controls never wrap. */
export function BrowserToolbar({ address, title, statusText, isLive, running, controlStatus, onTake, onHandBack, onExpand, onCollapse }: BrowserToolbarProps) {
  const hasControl = controlStatus === 'on' || controlStatus === 'taking'
  return (
    <HStack gap={2} vAlign="center" wrap="nowrap" padding={1} data-testid="browser-toolbar" xstyle={styles.row}>
      <HStack data-testid="browser-address-icon" data-secure={address?.isSecure ? 'true' : 'false'}>
        <Icon icon={address?.isSecure ? LockClosedIcon : GlobeAltIcon} color="secondary" size="sm" />
      </HStack>
      <HStack
        gap={1}
        vAlign="center"
        wrap="nowrap"
        data-testid="browser-address"
        aria-label={title ? `${title}: ${address ? `${address.host}${address.rest}` : 'No page open yet'}` : undefined}
        xstyle={styles.field}
      >
        {address ? (
          <>
            <Text weight="semibold" maxLines={1} xstyle={styles.host}>{address.host}</Text>
            {address.rest && <Text color="secondary" maxLines={1} xstyle={styles.rest}>{address.rest}</Text>}
          </>
        ) : (
          <Text color="secondary" maxLines={1} xstyle={styles.host}>No page open yet</Text>
        )}
      </HStack>
      {address?.href && <Link href={address.href} isExternalLink label="Open this page in a new tab" color="secondary" type="supporting">Open</Link>}
      <StatusDot variant={isLive ? 'success' : 'neutral'} label={statusText} isPulsing={isLive} />
      <Text type="supporting" color="secondary" maxLines={1} textWrap="nowrap">{statusText}</Text>
      {running && <Spinner size="sm" aria-label="The browser is working" />}
      {hasControl ? (
        <Button label="Hand back" size="sm" variant="primary" isDisabled={controlStatus === 'taking'} onClick={onHandBack} />
      ) : isLive ? (
        <Button label={controlStatus === 'held' ? 'Take control here' : 'Take control'} size="sm" onClick={onTake} />
      ) : null}
      {onCollapse ? (
        <IconButton label="Close expanded view" tooltip="Close expanded view" variant="ghost" size="sm" icon={<Icon icon={ArrowsPointingInIcon} size="sm" />} onClick={onCollapse} />
      ) : onExpand ? (
        <IconButton label="Expand" tooltip="Expand the browser view" variant="ghost" size="sm" icon={<Icon icon={ArrowsPointingOutIcon} size="sm" />} onClick={onExpand} />
      ) : null}
    </HStack>
  )
}
