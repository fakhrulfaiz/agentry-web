'use client'

/** Fetches one workspace file through the BFF as text (capped), for the preview renderers. */
import { useEffect, useState } from 'react'
import { artifactContentUrl } from '@/artifacts/artifact'

/** Longest text shown; the download has the rest. */
export const TEXT_LIMIT = 200_000

export interface FileBytes {
  status: 'loading' | 'ok' | 'missing' | 'error'
  text?: string
  truncated?: boolean
}

/** Browser URL of a session file's bytes; `download` asks for an attachment. */
export function fileUrl(sessionId: string, path: string, download = false): string {
  const url = `/api/agentry${artifactContentUrl(sessionId, path).replace(/^\/v1/, '')}`
  return download ? `${url}?download=1` : url
}

export function useFileText(sessionId: string, path: string, reloadKey: number, enabled = true): FileBytes {
  const [result, setResult] = useState<FileBytes>({ status: 'loading' })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setResult({ status: 'loading' })
    fetch(fileUrl(sessionId, path), { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) return setResult({ status: 'missing' })
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.text()
        const truncated = body.length > TEXT_LIMIT
        setResult({ status: 'ok', text: truncated ? body.slice(0, TEXT_LIMIT) : body, truncated })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: 'error' })
      })
    return () => controller.abort()
  }, [sessionId, path, reloadKey, enabled])
  return result
}

/** Browser URL of an Office file rendered as PDF by the API. */
export function pdfRenderUrl(sessionId: string, path: string): string {
  return `/api/agentry/agents/sessions/${encodeURIComponent(sessionId)}/renders/pdf/${path.split('/').map(encodeURIComponent).join('/')}`
}
