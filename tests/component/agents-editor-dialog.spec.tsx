// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
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
  it('reads new, starter and agent from the URL', () => {
    expect(editorTargetOf(new URLSearchParams(''))).toBeNull()
    expect(editorTargetOf(new URLSearchParams('new=1'))).toEqual({ kind: 'new' })
    expect(editorTargetOf(new URLSearchParams('starter=planner'))).toEqual({ kind: 'new', starterId: 'planner' })
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
})
