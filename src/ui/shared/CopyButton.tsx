'use client'

/** An icon button that copies `text` to the clipboard and says "Copied" for a moment. */
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return <IconButton label={copied ? 'Copied' : label} size="sm" variant="ghost" icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} />} onClick={() => void copy()} />
}
