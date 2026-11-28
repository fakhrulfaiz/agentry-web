// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorTargetOf } from '@/ui/agents/AgentEditorDialog'
import { AgentsPage } from '@/ui/agents/AgentsPage'

const { apiMock, nav } = vi.hoisted(() => ({
  apiMock: {
    listAgents: vi.fn(async () => ({ data: [{ id: 'agent_1', name: 'Mailer', model: 'm1', instructions: 'Sort mail' }] })),
    models: vi.fn(async () => ['m1']),
    listHostTools: vi.fn(async () => []),
    getAgent: vi.fn(async () => ({ id: 'agent_1', name: 'Mailer', model: 'm1', instructions: 'Sort mail' })),
    listSkills: vi.fn(async () => ({ data: [] })),
    listInstalledSkills: vi.fn(async () => []),
  },
  nav: { params: new URLSearchParams() },
}))
vi.mock('@/api/client', async (orig) => ({ ...(await orig<object>()), api: apiMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => nav.params }))

afterEach(() => {
  cleanup()
  nav.params = new URLSearchParams()
})

describe('editorTargetOf', () => {
  it('reads new and agent from the URL', () => {
    expect(editorTargetOf(new URLSearchParams(''))).toBeNull()
    expect(editorTargetOf(new URLSearchParams('new=1'))).toEqual({ kind: 'new' })
    expect(editorTargetOf(new URLSearchParams('agent=agent_1'))).toEqual({ kind: 'edit', agentId: 'agent_1' })
  })
})

describe('AgentsPage editor', () => {
  it('opens the editor dialog over the list for ?agent=', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    nav.params = new URLSearchParams('agent=agent_1')
    render(<AgentsPage />)
    expect(await screen.findByRole('textbox', { name: /Name/ })).toHaveValue('Mailer')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Mailer' })).toHaveAttribute('href', '/agents?agent=agent_1')
  })

  it('New agent changes the URL in place instead of navigating', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    render(<AgentsPage />)
    screen.getByRole('button', { name: 'New agent' }).click()
    expect(push).toHaveBeenCalledWith(null, '', '/agents?new=1')
  })

  it('closing an editor opened from a link replaces the URL instead of adding a history entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    nav.params = new URLSearchParams('new=1')
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<AgentsPage />)
    await screen.findByRole('textbox', { name: /Name/ })
    push.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(null, '', '/agents')
  })

  it('closing an editor the page opened goes back instead of adding a history entry', async () => {
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    render(<AgentsPage />)
    screen.getByRole('button', { name: 'New agent' }).click()
    expect(push).toHaveBeenCalledTimes(1)
    const { closeEditor } = await import('@/ui/agents/AgentsPage')
    closeEditor(true)
    expect(back).toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
  })
})
