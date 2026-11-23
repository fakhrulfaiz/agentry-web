// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsForm } from '@/ui/settings/ConnectorsForm'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => '/settings/connectors' }))

afterEach(() => {
  cleanup()
  refresh.mockReset()
  vi.unstubAllGlobals()
})

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ configured: true }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ConnectorsForm', () => {
  it('without a key explains what saving unlocks, saves it and refreshes the page', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    render(<ConnectorsForm configured={false} />)
    expect(screen.getByText('Add your connector key to browse and connect apps.')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Connector key'), 'ck_test_123')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put?.[1]?.body).toBe(JSON.stringify({ key: 'ck_test_123' }))
  })

  it('with a key shows a compact Saved row with Replace and Remove, no field', () => {
    render(<ConnectorsForm configured />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Connector key')).not.toBeInTheDocument()
  })

  it('Replace reveals the field and Save refreshes; Cancel hides it', async () => {
    const user = userEvent.setup()
    stubFetch()
    render(<ConnectorsForm configured />)
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Connector key')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await user.type(screen.getByLabelText('Connector key'), 'ck_new')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('removes a saved key and refreshes the page', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch()
    render(<ConnectorsForm configured />)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
  })

  it('shows an error for a rejected key and does not refresh', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_key' }, { status: 400 })))
    render(<ConnectorsForm configured={false} />)
    await user.type(screen.getByLabelText('Connector key'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/starts with ck_/)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
