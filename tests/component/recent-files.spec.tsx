// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ listSessions: vi.fn(), listSessionDeliverables: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))

const { RecentFiles } = await import('@/ui/chat/RecentFiles')

afterEach(cleanup)

it('shows a file delivered several times once, as its newest delivery', async () => {
  apiMock.listSessions.mockResolvedValue({ data: [{ id: 'sess_1', title: 'Report chat' }] })
  apiMock.listSessionDeliverables.mockResolvedValue({
    data: [
      { path: 'report.pdf', created_at: 100 },
      { path: 'report.pdf', created_at: 300 },
      { path: 'data.csv', created_at: 200 },
    ],
  })
  render(<RecentFiles />)
  const list = await screen.findByRole('list', { name: 'Recent files' })
  const names = within(list).getAllByRole('link').map((a) => a.textContent)
  expect(names).toEqual(['report.pdf', 'data.csv'])
})
