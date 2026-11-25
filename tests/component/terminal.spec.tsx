// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  openTerminal: vi.fn(),
  terminalInput: vi.fn(),
  terminalResize: vi.fn(),
  closeTerminal: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))

const xterm = vi.hoisted(() => ({ onData: undefined as ((d: string) => void) | undefined, written: [] as unknown[], disposed: false }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon() {}
    open() {}
    focus() {}
    write(d: unknown) { xterm.written.push(d) }
    onData(fn: (d: string) => void) { xterm.onData = fn; return { dispose() {} } }
    onResize() { return { dispose() {} } }
    dispose() { xterm.disposed = true }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class FakeSource {
  static last: FakeSource
  static CLOSED = 2
  readyState = 1
  listeners = new Map<string, (e: MessageEvent<string>) => void>()
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) { this.url = url; FakeSource.last = this }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) { this.listeners.set(name, fn) }
  close() { this.readyState = 2 }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>) }
}

import { Terminal } from '@/ui/terminal/Terminal'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeSource)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  apiMock.openTerminal.mockResolvedValue({ id: 'term_1' })
  apiMock.terminalInput.mockResolvedValue(undefined)
  apiMock.closeTerminal.mockResolvedValue(undefined)
  xterm.written = []
  xterm.disposed = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Terminal', () => {
  it('opens a shell, shows its output, sends keystrokes, and closes it', async () => {
    const user = userEvent.setup()
    render(<Terminal environmentId="env_1" />)
    await user.click(screen.getByRole('button', { name: 'Open terminal' }))
    await waitFor(() => expect(apiMock.openTerminal).toHaveBeenCalledWith('env_1', 80, 24))
    await waitFor(() => expect(FakeSource.last?.url).toBe('/api/agentry/agents/environments/env_1/terminals/term_1/stream'))
    FakeSource.last.emit('output', { data: btoa('hi') })
    expect([...(xterm.written[0] as Uint8Array)]).toEqual([104, 105])
    xterm.onData?.('ls\n')
    await waitFor(() => expect(apiMock.terminalInput).toHaveBeenCalledWith('env_1', 'term_1', 'ls\n'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(apiMock.closeTerminal).toHaveBeenCalledWith('env_1', 'term_1')
    expect(xterm.disposed).toBe(true)
  })

  it('says so when the shell ends, and offers a new one', async () => {
    const user = userEvent.setup()
    render(<Terminal environmentId="env_1" />)
    await user.click(screen.getByRole('button', { name: 'Open terminal' }))
    await waitFor(() => expect(FakeSource.last).toBeDefined())
    FakeSource.last.emit('exit', { code: 0 })
    expect(await screen.findByRole('button', { name: 'New terminal' })).toBeInTheDocument()
  })

  it('shows the API\'s reason when it cannot open one', async () => {
    const { ApiError } = await import('@/api/client')
    apiMock.openTerminal.mockRejectedValue(new ApiError(429, 'too_many_terminals', 'at most 4 terminals can be open; close one first'))
    const user = userEvent.setup()
    render(<Terminal environmentId="env_1" />)
    await user.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(await screen.findByText(/at most 4 terminals/)).toBeInTheDocument()
  })
})
