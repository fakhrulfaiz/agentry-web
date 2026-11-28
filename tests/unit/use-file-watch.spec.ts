// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileWatch } from '@/preview/use-file-watch'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>()
  closed = false
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }
  close() { this.closed = true }
  emit(type: string, data?: unknown) {
    const ev = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent
    for (const fn of this.listeners.get(type) ?? []) fn(ev)
  }
  fireError() { this.onerror?.(new Event('error')) }
}

describe('useFileWatch', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens the watch route and reports changed/reset events', () => {
    const onChange = vi.fn()
    renderHook(() => useFileWatch('s1', true, onChange))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]!.url).toBe('/api/agentry/agents/sessions/s1/artifacts/watch')
    act(() => { FakeEventSource.instances[0]!.emit('changed', { paths: ['a.txt'] }) })
    expect(onChange).toHaveBeenCalledWith(['a.txt'])
    act(() => { FakeEventSource.instances[0]!.emit('reset', {}) })
    expect(onChange).toHaveBeenCalledWith('reset')
  })

  it('reconnects with backoff on error', () => {
    const onChange = vi.fn()
    renderHook(() => useFileWatch('s1', true, onChange))
    expect(FakeEventSource.instances).toHaveLength(1)
    act(() => { FakeEventSource.instances[0]!.fireError() })
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
    act(() => { vi.advanceTimersByTime(999) })
    expect(FakeEventSource.instances).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => { FakeEventSource.instances[1]!.fireError() })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('stops reconnecting after closed event until re-enabled', () => {
    const onChange = vi.fn()
    const { rerender } = renderHook(({ enabled }) => useFileWatch('s1', enabled, onChange), { initialProps: { enabled: true } })
    act(() => { FakeEventSource.instances[0]!.emit('closed', {}) })
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(FakeEventSource.instances).toHaveLength(1)

    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('closes on disable/unmount', () => {
    const onChange = vi.fn()
    const { rerender, unmount } = renderHook(({ enabled }) => useFileWatch('s1', enabled, onChange), { initialProps: { enabled: true } })
    const es = FakeEventSource.instances[0]!
    rerender({ enabled: false })
    expect(es.closed).toBe(true)

    rerender({ enabled: true })
    const es2 = FakeEventSource.instances[1]!
    unmount()
    expect(es2.closed).toBe(true)
  })
})
