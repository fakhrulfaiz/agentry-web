'use client'

/**
 * Office files (Word, Excel, PowerPoint) shown as PDF pages: the API converts
 * them (`/renders/pdf/...`), the browser keeps the PDF by its ETag, and the
 * bytes show in the same iframe the PDF renderer uses (as a blob URL).
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { fileUrl, pdfRenderUrl } from '@/preview/use-file-bytes'

const styles = stylex.create({
  frame: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' },
  pdf: { flex: 1, inlineSize: '100%', minBlockSize: 0, borderWidth: 0 },
})

type State =
  | { status: 'loading' }
  | { status: 'ok'; url: string; fonts: string[] }
  | { status: 'missing' }
  | { status: 'error'; message: string }

const MESSAGES: Record<number, string> = {
  413: 'This file is too large to preview.',
  422: 'This file could not be read as a document.',
  503: 'Preview is busy or unavailable. Try again.',
  504: 'Preview timed out.',
}

export function OfficePdfView({ sessionId, path, reloadKey, onMissing, onRetry }: { sessionId: string; path: string; reloadKey: number; onMissing?: () => void; onRetry?: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    setState({ status: 'loading' })
    ;(async () => {
      const res = await fetch(pdfRenderUrl(sessionId, path), { signal: controller.signal, cache: 'no-cache' })
      if (res.status === 404) return setState({ status: 'missing' })
      if (!res.ok) return setState({ status: 'error', message: MESSAGES[res.status] ?? 'Could not render this document.' })
      const fonts = (res.headers.get('x-agentry-missing-fonts') ?? '').split(',').filter(Boolean).map((n) => {
        try {
          return decodeURIComponent(n)
        } catch {
          return n
        }
      })
      url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }))
      if (controller.signal.aborted) return URL.revokeObjectURL(url)
      setState({ status: 'ok', url, fonts })
    })().catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error', message: 'Could not render this document.' })
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [sessionId, path, reloadKey])
  useEffect(() => {
    if (state.status === 'missing') onMissing?.()
  }, [state.status, onMissing])

  if (state.status === 'loading')
    return (
      <VStack gap={2} padding={4}>
        <Skeleton height={160} />
        <Text type="supporting" color="secondary">Rendering document...</Text>
      </VStack>
    )
  if (state.status === 'missing') return <Banner status="warning" title="File no longer exists." />
  if (state.status === 'error')
    return (
      <Banner
        status="error"
        title={state.message}
        endContent={
          <HStack gap={2}>
            {onRetry && <Button label="Retry" onClick={onRetry} />}
            <Button label="Download" href={fileUrl(sessionId, path, true)} />
          </HStack>
        }
      />
    )
  return (
    <div {...stylex.props(styles.frame)}>
      {state.fonts.length > 0 && (
        <HStack padding={2}>
          <Tooltip content={state.fonts.join(', ')}>
            <Text type="supporting" color="secondary">Some fonts are not installed; the layout may differ.</Text>
          </Tooltip>
        </HStack>
      )}
      <iframe title={path} src={state.url} {...stylex.props(styles.pdf)} />
    </div>
  )
}
