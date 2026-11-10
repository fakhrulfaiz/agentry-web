'use client'

/**
 * The preview dialog of the Artifacts page: an image, a PDF in an iframe, or
 * text in a pre; any other type offers the download only.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import type { Artifact } from '@/api/types'
import { artifactUrl, previewMode } from '@/artifacts/kind'

/** Longest text shown in the preview; the download has the rest. */
const TEXT_LIMIT = 200_000

function TextPreview({ artifact }: { artifact: Artifact }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setText(null)
    setFailed(false)
    fetch(artifactUrl(artifact), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      .then((body) => setText(body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n…` : body))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [artifact])
  if (failed) return <Banner status="error" title="Could not load the preview." />
  if (text === null) return <Skeleton height={160} />
  return (
    <pre
      data-testid="artifact-text"
      style={{ margin: 0, maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13 }}
    >
      {text}
    </pre>
  )
}

function Body({ artifact }: { artifact: Artifact }) {
  switch (previewMode(artifact)) {
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- BFF bytes of unknown size; next/image does not apply
        <img
          src={artifactUrl(artifact)}
          alt={artifact.name}
          style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', alignSelf: 'center' }}
        />
      )
    case 'pdf':
      return <iframe title={artifact.name} src={artifactUrl(artifact)} style={{ width: '100%', height: '60vh', border: 0 }} />
    case 'text':
      return <TextPreview artifact={artifact} />
    case 'none':
      return <Text type="supporting">No preview is available for this file type. Download it to open it.</Text>
  }
}

export function ArtifactPreview({
  artifact,
  onClose,
  onOpenChat,
}: {
  artifact: Artifact | null
  onClose(): void
  onOpenChat(sessionId: string): void
}) {
  return (
    <Dialog isOpen={artifact !== null} onOpenChange={(open) => !open && onClose()} width={800}>
      {artifact && (
        <>
          <DialogHeader title={artifact.name} subtitle={artifact.session_title} />
          <VStack gap={4}>
            <Body artifact={artifact} />
            <HStack gap={2} hAlign="end">
              <Button label="Open chat" onClick={() => onOpenChat(artifact.session_id)} />
              <Button label="Download" variant="primary" href={artifactUrl(artifact, true)} />
            </HStack>
          </VStack>
        </>
      )}
    </Dialog>
  )
}
