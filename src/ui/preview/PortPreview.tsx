'use client'

/**
 * The panel's Preview tab: the web app a sandbox chat started, shown in a sandboxed frame. A port picker (ports the
 * sandbox listens on, refreshed every 5 s, or any port typed in), Reload and Open in a new tab. The app is served by
 * the BFF at `/preview/<token>/`, in an opaque origin: it cannot reach this app or its session.
 */
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { CopyButton } from '@/ui/shared/CopyButton'

export const PREVIEW_VIEW = 'preview'
export const PREVIEW_TITLE = 'Preview'

/** Re-mint this long before a token expires. */
const REMINT_BEFORE_MS = 60_000
const POLL_MS = 5_000
const OTHER = '__other__'

/** A port number from typed text, or `null`. */
export function parsePort(text: string): number | null {
  const n = Number(text.trim())
  return /^\d{1,5}$/.test(text.trim()) && n >= 1 && n <= 65535 ? n : null
}

const styles = stylex.create({
  tab: { flexGrow: 1, minBlockSize: 0, blockSize: '100%' },
  frame: {
    flexGrow: 1,
    minBlockSize: 0,
    inlineSize: '100%',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: 'white',
  },
  note: { minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})

function usePorts(environmentId: string): { ports: number[]; loaded: boolean } {
  const [state, setState] = useState<{ ports: number[]; loaded: boolean }>({ ports: [], loaded: false })
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const list = await api.listEnvironmentPorts(environmentId, abort.signal)
        setState({ ports: list.data.map((p) => p.port), loaded: true })
      } catch {
        if (abort.signal.aborted) return
        setState((s) => ({ ...s, loaded: true }))
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [environmentId])
  return state
}

/** The signed preview base for `port`, kept fresh until the tab closes; `null` while minting or when it failed. */
function usePreviewUrl(environmentId: string, port: number | null): string | null {
  const [minted, setMinted] = useState<{ port: number; url: string } | null>(null)
  useEffect(() => {
    if (port === null) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const mint = async () => {
      try {
        const r = await api.mintPreview(environmentId, port)
        if (stopped) return
        setMinted({ port, url: r.url })
        timer = setTimeout(() => void mint(), Math.max(10_000, r.expires_at - Date.now() - REMINT_BEFORE_MS))
      } catch {
        if (!stopped) timer = setTimeout(() => void mint(), 10_000)
      }
    }
    void mint()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [environmentId, port])
  return minted && minted.port === port ? minted.url : null
}

export function PortPreview({ environmentId }: { environmentId: string }) {
  const { ports, loaded } = usePorts(environmentId)
  const [choice, setChoice] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [custom, setCustom] = useState<number | null>(null)
  const [reloads, setReloads] = useState(0)

  // Until the user chooses, follow the first port that appears.
  const detected = ports[0] ?? null
  const port = choice === OTHER ? custom : choice !== null ? Number(choice) : detected
  const url = usePreviewUrl(environmentId, port)
  const apply = useCallback(() => setCustom(parsePort(typed)), [typed])

  if (!loaded) return <EmptyState title="Looking for a running app…" headingLevel={2} />
  if (ports.length === 0 && choice !== OTHER) {
    return (
      <EmptyState
        title="Nothing is listening yet"
        description="Ask the agent to start your app, for example `npm run dev -- --host 0.0.0.0`. The app has to listen on 0.0.0.0, not only on 127.0.0.1."
        headingLevel={2}
        data-testid="preview-empty"
      />
    )
  }
  const options = [...ports.map((p) => ({ value: String(p), label: `localhost:${String(p)}` })), { value: OTHER, label: 'Other port…' }]
  return (
    <VStack gap={2} data-testid="port-preview" xstyle={styles.tab}>
      <HStack gap={2} vAlign="center" wrap="nowrap">
        <Selector
          label="Port"
          isLabelHidden
          size="sm"
          variant="secondary"
          options={options}
          value={choice === OTHER ? OTHER : port !== null ? String(port) : undefined}
          onChange={(v: string | null) => { if (v !== null) setChoice(v) }}
        />
        {choice === OTHER && <TextInput label="Port number" isLabelHidden size="sm" inputMode="numeric" placeholder="3000" value={typed} onChange={setTyped} onEnter={apply} width={96} />}
        <IconButton label="Reload" tooltip="Reload" variant="ghost" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} isDisabled={url === null} onClick={() => setReloads((n) => n + 1)} />
        {url !== null && (
          <IconButton label="Open in a new tab" tooltip="Open in a new tab" variant="ghost" size="sm" icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />} onClick={() => window.open(url, '_blank', 'noopener')} />
        )}
        {url !== null && <CopyButton text={`${window.location.origin}${url}`} label="Copy the base path" />}
      </HStack>
      {url !== null ? (
        <iframe
          key={`${url}#${String(reloads)}`}
          title={`Preview of port ${String(port)}`}
          src={url}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          {...stylex.props(styles.frame)}
        />
      ) : (
        <EmptyState title={port === null ? 'Enter a port number' : 'Opening the preview…'} headingLevel={2} />
      )}
      <Text type="supporting" color="secondary" maxLines={1} xstyle={styles.note}>Absolute paths like /app.js need the app started with the copied base path.</Text>
    </VStack>
  )
}
