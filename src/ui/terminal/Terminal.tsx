'use client'

/**
 * An interactive shell inside a sandbox (`xterm.js`): opens a PTY through the
 * API, reads its output over SSE and sends keystrokes and resizes back as small
 * POSTs. The browser never learns an address into the sandbox. Closing the
 * view (or leaving the page) closes the terminal.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api/client'
import '@xterm/xterm/css/xterm.css'

const HEIGHT = 380

type Phase = 'idle' | 'starting' | 'open' | 'ended'

const bytesFromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

export function Terminal({ environmentId, isDisabled = false, variant = 'inline' }: { environmentId: string; isDisabled?: boolean; variant?: 'inline' | 'pane' }) {
  const host = useRef<HTMLDivElement | null>(null)
  const teardown = useRef<(() => void) | null>(null)
  // Each start() is a run; unmounting (or starting again) invalidates earlier runs so a late open is closed, not leaked.
  const runId = useRef(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    teardown.current?.()
    teardown.current = null
  }, [])
  useEffect(
    () => () => {
      runId.current += 1
      stop()
    },
    [stop],
  )

  const start = useCallback(async () => {
    const element = host.current
    if (!element) return
    stop()
    const run = ++runId.current
    setError(null)
    setPhase('starting')
    const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
    if (run !== runId.current) return
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#0b0d10', foreground: '#d7dae0' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)
    fit.fit()
    let terminalId: string
    try {
      terminalId = (await api.openTerminal(environmentId, term.cols, term.rows)).id
      if (run !== runId.current) {
        term.dispose()
        void api.closeTerminal(environmentId, terminalId).catch(() => undefined)
        return
      }
    } catch (err) {
      term.dispose()
      if (run !== runId.current) return
      setError(err instanceof ApiError ? err.message : 'Could not open a terminal.')
      setPhase('idle')
      return
    }
    const source = new EventSource(`/api/agentry/agents/environments/${encodeURIComponent(environmentId)}/terminals/${encodeURIComponent(terminalId)}/stream`)
    source.addEventListener('output', (event) => {
      const { data } = JSON.parse((event as MessageEvent<string>).data) as { data: string }
      term.write(bytesFromBase64(data))
    })
    source.addEventListener('exit', () => {
      source.close()
      term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
      setPhase('ended')
    })
    // EventSource reconnects by itself after a drop, and the API replays the retained output to every new
    // reader, so a reconnect starts from a clean screen instead of writing the replay on top of it.
    let opened = false
    source.addEventListener('open', () => {
      if (opened) term.reset()
      opened = true
    })
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setPhase((cur) => (cur === 'open' ? 'ended' : cur))
    }
    // Keystrokes go in order, batched while a request is in flight.
    let pending = ''
    let sending = false
    const flush = async () => {
      if (sending) return
      sending = true
      try {
        while (pending !== '') {
          const data = pending
          pending = ''
          await api.terminalInput(environmentId, terminalId, data)
        }
      } catch (err) {
        term.write(`\r\n\x1b[31m[${err instanceof ApiError ? err.message : 'input failed'}]\x1b[0m\r\n`)
      } finally {
        sending = false
      }
    }
    const typed = term.onData((data) => {
      pending += data
      void flush()
    })
    const resized = term.onResize(({ cols, rows }) => void api.terminalResize(environmentId, terminalId, cols, rows).catch(() => undefined))
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(element)
    term.focus()
    setPhase('open')
    teardown.current = () => {
      observer.disconnect()
      typed.dispose()
      resized.dispose()
      source.close()
      term.dispose()
      void api.closeTerminal(environmentId, terminalId).catch(() => undefined)
    }
  }, [environmentId, stop])

  useEffect(() => {
    if (variant === 'pane') void start()
  }, [variant, start])

  const close = () => {
    stop()
    setPhase('idle')
  }
  const showing = phase === 'starting' || phase === 'open' || phase === 'ended'
  if (variant === 'pane') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {error !== null && <Banner status="error" title={error} endContent={<Button label="Try again" size="sm" onClick={() => void start()} />} />}
        {phase === 'ended' && <Banner status="info" title="The shell ended." endContent={<Button label="New shell" size="sm" onClick={() => void start()} />} />}
        <div ref={host} data-testid="terminal-host" aria-label="Terminal" style={{ flex: 1, minHeight: 0, padding: 8, background: '#0b0d10', overflow: 'hidden' }} />
      </div>
    )
  }
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill"><Text type="supporting" color="secondary">A shell inside the sandbox, as the agent user.</Text></StackItem>
        {!showing && <Button label="Open terminal" size="sm" isDisabled={isDisabled} onClick={() => void start()} />}
        {phase === 'ended' && <Button label="New terminal" size="sm" onClick={() => void start()} />}
        {showing && <Button label="Close" size="sm" variant="ghost" onClick={close} />}
      </HStack>
      {error !== null && <Banner status="error" title={error} />}
      <div ref={host} data-testid="terminal-host" aria-label="Terminal" style={{ display: showing ? 'block' : 'none', height: HEIGHT, padding: 8, background: '#0b0d10', borderRadius: 4, overflow: 'hidden' }} />
    </VStack>
  )
}
