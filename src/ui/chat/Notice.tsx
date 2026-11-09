'use client'

import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import type { MessageView } from '@/chat/reducer'

type NoticeView = Extract<MessageView, { kind: 'notice' }>

const STATUS = { failed: 'error', interrupted: 'warning', cancelled: 'info' } as const
const TITLE = { failed: 'The turn failed', interrupted: 'The turn was interrupted', cancelled: 'Stopped' } as const

/** A failed, interrupted or stopped turn, with Retry when there is a message to resend. */
export function Notice({ view, onRetry }: { view: NoticeView; onRetry?: () => void }) {
  const description = view.message && view.message !== TITLE[view.level] ? view.message : undefined
  return (
    <Banner
      status={STATUS[view.level]}
      title={TITLE[view.level]}
      description={description}
      endContent={onRetry ? <Button label="Retry" size="sm" onClick={onRetry} /> : undefined}
    />
  )
}
