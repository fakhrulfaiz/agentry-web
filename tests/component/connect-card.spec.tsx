// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectCard } from '@/ui/chat/ConnectCard'
import { ToolCard } from '@/ui/chat/ToolCard'

afterEach(cleanup)
const url = 'https://connect.composio.dev/link/lk_1'

describe('ConnectCard', () => {
  it('links the Connect button to the sign-in page in a new tab', () => {
    render(<ConnectCard request={{ toolkit: 'gmail', url, status: 'initiated' }} />)
    const link = screen.getByRole('link', { name: 'Connect Gmail' })
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('names an unknown app generically', () => {
    render(<ConnectCard request={{ toolkit: null, url, status: 'unknown' }} />)
    expect(screen.getByRole('link', { name: 'Connect app' })).toBeInTheDocument()
  })
})

describe('ConnectSettingsLink in a tool card', () => {
  it('links to the connectors page when a call failed because the app is not connected', () => {
    render(<ToolCard view={{ kind: 'tool', id: 't1', callId: 'c1', name: 'googlecalendar_list_events', args: {}, status: 'done', output: '{"error":"No connected account found for googlecalendar"}' }} />)
    expect(screen.getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('href', '/settings/connectors')
  })

  it('shows nothing extra for an ordinary result', () => {
    render(<ToolCard view={{ kind: 'tool', id: 't2', callId: 'c2', name: 'gmail_search_emails', args: {}, status: 'done', output: '{"messages":[]}' }} />)
    expect(screen.queryByRole('link', { name: /Connect/u })).toBeNull()
  })
})
