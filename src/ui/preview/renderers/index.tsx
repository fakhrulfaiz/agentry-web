'use client'

/**
 * Renderers for the preview panel, one small view per renderer id. Text-based
 * views read at most TEXT_LIMIT characters through the BFF; HTML renders in a
 * sandboxed iframe (never `allow-same-origin`), so agent-authored markup cannot
 * reach the signed-in app.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useMemo, useState } from 'react'
import type { RendererId } from '@/preview/renderers'
import { fileUrl, useFileText } from '@/preview/use-file-bytes'
import { Markdown } from '@/ui/chat/Markdown'

const TABLE_ROW_LIMIT = 2000

export interface RendererProps {
  id: RendererId
  sessionId: string
  path: string
  reloadKey: number
  wrap: boolean
  runScripts: boolean
  /** Called when the file is gone (404), so the panel can refresh its tree. */
  onMissing?: () => void
  onRetry?: () => void
}

const preBox = { margin: 0, padding: 16, fontSize: 13, lineHeight: 1.6 } as const

/** Splits CSV/TSV text into rows, honouring quoted fields and doubled quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function highlightLanguage(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json',
    sh: 'bash', html: 'xml', xml: 'xml', css: 'css', sql: 'sql', go: 'go', rs: 'rust', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', rb: 'ruby', yaml: 'yaml', yml: 'yaml', toml: 'ini', md: 'markdown',
  }
  return map[ext] ?? null
}

function CodeBlock({ text, path, wrap }: { text: string; path: string; wrap: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const lang = highlightLanguage(path)
    if (!lang) return setHtml(null)
    Promise.all([import('highlight.js/lib/core'), import(`highlight.js/lib/languages/${lang}.js`)])
      .then(([core, language]) => {
        const hljs = core.default
        if (!hljs.getLanguage(lang)) hljs.registerLanguage(lang, language.default)
        if (alive) setHtml(hljs.highlight(text, { language: lang }).value)
      })
      .catch(() => alive && setHtml(null))
    return () => {
      alive = false
    }
  }, [text, path])
  const style = { ...preBox, whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : 'normal' } as const
  // hljs escapes the source text, so its output is safe to inject.
  return html === null ? (
    <pre style={style}>{text}</pre>
  ) : (
    <pre style={style}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

function Table({ text, path }: { text: string; path: string }) {
  const rows = useMemo(() => parseDelimited(text, path.toLowerCase().endsWith('.tsv') ? '\t' : ','), [text, path])
  const [head, ...body] = rows
  const shown = body.slice(0, TABLE_ROW_LIMIT)
  return (
    <VStack gap={2}>
      {body.length > TABLE_ROW_LIMIT && <Banner status="info" title={`Showing the first ${TABLE_ROW_LIMIT} of ${body.length} rows. Download for the rest.`} />}
      <div style={{ overflow: 'auto', fontSize: 13 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {(head ?? []).map((cell, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '4px 8px', whiteSpace: 'nowrap' }}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VStack>
  )
}

function JsonNode({ name, value }: { name?: string; value: unknown }) {
  const label = name === undefined ? '' : `${name}: `
  if (value === null || typeof value !== 'object') return <div style={{ paddingLeft: 16 }}>{label}{JSON.stringify(value)}</div>
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  return (
    <details open style={{ paddingLeft: 16 }}>
      <summary>{label}{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</summary>
      {entries.map(([k, v]) => (
        <JsonNode key={k} name={k} value={v} />
      ))}
    </details>
  )
}

/** Page chrome for converted Word documents; the iframe is sandboxed and sets its own light surface. */
const DOCX_SHELL = (body: string) =>
  `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#fff;color:#111}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid rgba(128,128,128,.5);padding:4px 8px}</style>${body}`

/** Word documents: converted to HTML in the browser (mammoth), then shown in a sandboxed iframe like HTML files. */
function DocxView({ sessionId, path, reloadKey, onMissing, onRetry }: RendererProps) {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'missing' | 'error'; html?: string }>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    ;(async () => {
      const res = await fetch(fileUrl(sessionId, path), { signal: controller.signal })
      if (res.status === 404) return setState({ status: 'missing' })
      if (!res.ok) throw new Error(String(res.status))
      const mammoth = await import('mammoth')
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() })
      setState({ status: 'ok', html: DOCX_SHELL(value) })
    })().catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [sessionId, path, reloadKey])
  useEffect(() => {
    if (state.status === 'missing') onMissing?.()
  }, [state.status, onMissing])
  if (state.status === 'loading') return <Skeleton height={160} />
  if (state.status === 'missing') return <Banner status="warning" title="File no longer exists." />
  if (state.status === 'error' || state.html === undefined)
    return <Banner status="error" title="Could not open this document. Download it instead." endContent={onRetry ? <Button label="Retry" onClick={onRetry} /> : undefined} />
  return <iframe title={path} sandbox="" srcDoc={state.html} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'white' }} />
}

function DownloadCard({ sessionId, path }: { sessionId: string; path: string }) {
  return (
    <VStack gap={3} hAlign="center" style={{ padding: 48 }}>
      <Text type="supporting" color="secondary">No preview is available for this file type.</Text>
      <Button label="Download" variant="primary" href={fileUrl(sessionId, path, true)} />
    </VStack>
  )
}

function TextBased({ props }: { props: RendererProps }) {
  const { id, sessionId, path, reloadKey, wrap, runScripts, onMissing, onRetry } = props
  const file = useFileText(sessionId, path, reloadKey)
  useEffect(() => {
    if (file.status === 'missing') onMissing?.()
  }, [file.status, onMissing])
  if (file.status === 'loading') return <Skeleton height={160} />
  if (file.status === 'missing') return <Banner status="warning" title="File no longer exists." />
  if (file.status === 'error' || file.text === undefined)
    return <Banner status="error" title="Could not load the preview." endContent={onRetry ? <Button label="Retry" onClick={onRetry} /> : undefined} />
  const text = file.text
  const notice = file.truncated && <Banner status="info" title="Showing the first 200,000 characters. Download for the rest." />
  let body: React.ReactNode
  switch (id) {
    case 'markdown':
      body = <div style={{ padding: '20px 24px' }}><Markdown text={text} /></div>
      break
    case 'html':
      body = <iframe title={path} sandbox={runScripts ? 'allow-scripts' : ''} srcDoc={text} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'white' }} />
      break
    case 'table':
      body = <div style={{ padding: 16 }}><Table text={text} path={path} /></div>
      break
    case 'json': {
      let parsed: { ok: true; value: unknown } | { ok: false } = { ok: false }
      try {
        parsed = { ok: true, value: JSON.parse(text) }
      } catch {}
      body = parsed.ok ? <div style={{ padding: 16, fontSize: 13, fontFamily: 'monospace' }}><JsonNode value={parsed.value} /></div> : <CodeBlock text={text} path={path} wrap={wrap} />
      break
    }
    case 'code':
      body = <CodeBlock text={text} path={path} wrap={wrap} />
      break
    default:
      body = <pre style={{ ...preBox, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{text}</pre>
  }
  return (
    <>
      {notice}
      {body}
    </>
  )
}

export function RendererBody(props: RendererProps) {
  const { id, sessionId, path } = props
  switch (id) {
    case 'image':
      // eslint-disable-next-line @next/next/no-img-element -- BFF bytes of unknown size; next/image does not apply
      return <img src={fileUrl(sessionId, path)} alt={path} style={{ maxWidth: '100%', objectFit: 'contain', display: 'block', margin: '0 auto', padding: 16 }} />
    case 'pdf':
      return <iframe title={path} src={fileUrl(sessionId, path)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
    case 'docx':
      return <DocxView {...props} />
    case 'download':
      return <DownloadCard sessionId={sessionId} path={path} />
    case 'source':
      return <TextBased props={{ ...props, id: 'code' }} />
    default:
      return <TextBased props={props} />
  }
}
