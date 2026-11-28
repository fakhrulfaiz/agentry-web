// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandboxEnvironment } from '@/api/types'

const apiMock = vi.hoisted(() => ({ getSandboxEnvironment: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return { ...original, api: { ...original.api, getSandboxEnvironment: apiMock.getSandboxEnvironment } }
})

const { ApiError } = await import('@/api/client')
const { ChatEnvironmentChip } = await import('@/ui/chat/ChatEnvironmentChip')

const env = (overrides: Partial<SandboxEnvironment> = {}): SandboxEnvironment => ({
  id: 'env_1',
  object: 'agent.environment',
  type: 'openai_hosted',
  status: 'connected',
  provider: 'sandbox',
  created_at: 1,
  name: 'Data box',
  ...overrides,
})

const sandbox = (environment_id = 'env_1') => ({ type: 'sandbox', environment_id })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  apiMock.getSandboxEnvironment.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChatEnvironmentChip', () => {
  it('names the server workspace and makes no request for a local chat', () => {
    render(<ChatEnvironmentChip environment={{ type: 'local' }} />)
    expect(screen.getByText('Server')).toBeInTheDocument()
    expect(apiMock.getSandboxEnvironment).not.toHaveBeenCalled()
  })

  it('shows the sandbox name and live state from one environment GET', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue(env({ sandbox: { state: 'running' } }))
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(apiMock.getSandboxEnvironment).toHaveBeenCalledWith('env_1')
    expect(await screen.findByText('Data box · Running')).toBeInTheDocument()
    expect(apiMock.getSandboxEnvironment).toHaveBeenCalledTimes(1)
  })

  it('reports a sandbox that has been removed', async () => {
    apiMock.getSandboxEnvironment.mockRejectedValue(new ApiError(404, 'not_found', 'gone'))
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(await screen.findByText('Removed sandbox')).toBeInTheDocument()
  })

  it('falls back quietly when the environment cannot be loaded', async () => {
    apiMock.getSandboxEnvironment.mockRejectedValue(new ApiError(503, 'unavailable', 'down'))
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(await screen.findByText('Sandbox')).toBeInTheDocument()
    expect(screen.getByText('Sandbox').closest('[aria-description]')).toHaveAttribute(
      'aria-description',
      'Could not load sandbox details (env_1)',
    )
  })

  it('keeps the current sandbox when an older request resolves later', async () => {
    const first = deferred<SandboxEnvironment>()
    apiMock.getSandboxEnvironment
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(env({ id: 'env_2', name: 'Lab', sandbox: { state: 'running' } }))
    const { rerender } = render(<ChatEnvironmentChip environment={sandbox('env_1')} />)
    expect(screen.getByText('Sandbox')).toBeInTheDocument()

    rerender(<ChatEnvironmentChip environment={sandbox('env_2')} />)
    expect(await screen.findByText('Lab · Running')).toBeInTheDocument()

    await act(async () => {
      first.resolve(env({ id: 'env_1', name: 'Old', sandbox: { state: 'running' } }))
    })
    expect(screen.getByText('Lab · Running')).toBeInTheDocument()
    expect(screen.queryByText('Old · Running')).not.toBeInTheDocument()
  })

  it('keeps a newer refresh when an older request for the same sandbox resolves later', async () => {
    const first = deferred<SandboxEnvironment>()
    apiMock.getSandboxEnvironment
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(env({ sandbox: { state: 'stopped' } }))
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(screen.getByText('Sandbox')).toBeInTheDocument()

    fireEvent(window, new Event('focus'))
    expect(await screen.findByText('Data box · Stopped')).toBeInTheDocument()

    await act(async () => {
      first.resolve(env({ sandbox: { state: 'running' } }))
    })
    expect(screen.getByText('Data box · Stopped')).toBeInTheDocument()
    expect(screen.queryByText('Data box · Running')).not.toBeInTheDocument()
  })

  it('refreshes on window focus without polling', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue(env({ sandbox: { state: 'running' } }))
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(await screen.findByText('Data box · Running')).toBeInTheDocument()
    expect(apiMock.getSandboxEnvironment).toHaveBeenCalledTimes(1)

    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(apiMock.getSandboxEnvironment).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Data box · Running')).toBeInTheDocument()
  })

  it('refreshes when the tab becomes visible', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue(env({ sandbox: { state: 'running' } }))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(<ChatEnvironmentChip environment={sandbox()} />)
    expect(await screen.findByText('Data box · Running')).toBeInTheDocument()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(apiMock.getSandboxEnvironment).toHaveBeenCalledTimes(2))
  })

  it('is information, not a control', () => {
    render(<ChatEnvironmentChip environment={{ type: 'local' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
