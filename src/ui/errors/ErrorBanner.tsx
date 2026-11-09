'use client'

import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'

/** Agentry's store is unavailable (503): say so and offer a retry. */
export function ErrorBanner({
  title = 'Agentry is temporarily unavailable',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry: () => void
}) {
  return (
    <Banner
      status="error"
      container="section"
      title={title}
      description={message}
      endContent={<Button label="Retry" size="sm" onClick={onRetry} />}
    />
  )
}

/** True for the errors that get the banner (503, e.g. `store_unavailable`). */
export function isUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 503
}
