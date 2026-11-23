// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectCard } from '@/ui/chat/ConnectCard'

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
