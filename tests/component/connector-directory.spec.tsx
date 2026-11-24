// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogEntry } from '@/connectors/catalog'
import { ConnectorDirectory } from '@/ui/settings/ConnectorDirectory'

function stubStatus(connected: string[] | null) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected })))
}

beforeEach(() => stubStatus(null))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const many: CatalogEntry[] = Array.from({ length: 30 }, (_, i) => ({ slug: `app${i}`, name: `App ${i}`, category: i % 2 ? 'email' : 'crm', toolCount: i }))
const entries: CatalogEntry[] = [{ slug: 'gmail', name: 'Gmail', category: 'email', toolCount: 63 }, ...many]
const featured = [entries[0]]

describe('ConnectorDirectory', () => {
  it('shows Featured first, then 24 cards with Show more', async () => {
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Featured', 'All connectors'])
    expect(within(screen.getByRole('list', { name: 'Connectors' })).getAllByRole('listitem')).toHaveLength(24)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(within(screen.getByRole('list', { name: 'Connectors' })).getAllByRole('listitem')).toHaveLength(31)
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('search filters, hides Featured and reports no matches', async () => {
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search connectors' }), 'gmail')
    expect(screen.queryByRole('heading', { name: 'Featured' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Connectors' })).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search connectors' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search connectors' }), 'zzzz')
    expect(screen.getByText('No connectors match your search.')).toBeInTheDocument()
  })

  it('category chips filter the grid', async () => {
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    await userEvent.click(within(screen.getByRole('group', { name: 'Categories' })).getByRole('button', { name: 'Crm' }))
    expect(within(screen.getByRole('list', { name: 'Connectors' })).getAllByRole('listitem')).toHaveLength(15)
  })

  it('Connect links to a new chat with the prefilled message', () => {
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    const links = screen.getAllByRole('link', { name: 'Connect Gmail' })
    expect(links).toHaveLength(2) // Featured and the grid
    expect(links[0]).toHaveAttribute('href', '/?prompt=Connect%20my%20Gmail%20account')
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('loads status after paint: a Connected section, Connected instead of Connect, no Add another', async () => {
    stubStatus(['gmail'])
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    await screen.findByRole('heading', { name: 'Connected' })
    expect(screen.queryByRole('link', { name: 'Connect Gmail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add another/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(1)
    expect(screen.getAllByRole('link', { name: 'Connect App 0' }).length).toBeGreaterThan(0)
  })

  it('shows a quiet notice when the catalog fell back, and a letter avatar when a logo fails', async () => {
    const { container } = render(<ConnectorDirectory entries={entries} featured={featured} failed />)
    expect(screen.getByText(/full connector list is unavailable/)).toBeInTheDocument()
    const img = container.querySelector('img[src="https://logos.composio.dev/api/gmail"]') as HTMLImageElement
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveAttribute('alt', '')
    fireEvent.error(img)
    await waitFor(() => expect(container.querySelectorAll('img[src="https://logos.composio.dev/api/gmail"]')).toHaveLength(1))
  })

  it('paints a fresh status from the server at once and does not ask again', async () => {
    const fetchMock = vi.fn(async () => Response.json({ connected: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} initialStatus={{ connected: ['gmail'], checkedAt: Date.now(), stale: false }} />)
    expect(screen.getByRole('heading', { name: 'Connected' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps showing a stale status while it checks again', async () => {
    stubStatus([])
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} initialStatus={{ connected: ['gmail'], checkedAt: Date.now() - 120_000, stale: true }} />)
    expect(screen.getByRole('heading', { name: 'Connected' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Connected' })).not.toBeInTheDocument())
  })

  it('says when Composio rejected the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: null, checkedAt: 0, stale: false, problem: 'rejected' })))
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} />)
    expect(await screen.findByText(/Composio rejected your key/)).toBeInTheDocument()
  })

  it('Refresh checks Composio now', async () => {
    const fetchMock = vi.fn(async () => Response.json({ connected: [], checkedAt: Date.now(), stale: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ConnectorDirectory entries={entries} featured={featured} failed={false} initialStatus={{ connected: [], checkedAt: Date.now(), stale: false }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agentry/connectors/status?refresh=1', expect.anything()))
  })
})
