// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '@/ui/chat/Markdown'

afterEach(cleanup)

describe('Markdown links', () => {
  it('renders a connect link as a button-like link with its own label', () => {
    render(<Markdown text="## 👉 [Connect Gmail](https://connect.composio.dev/link/lk_x)" />)
    const link = screen.getByRole('link', { name: /Connect Gmail/ })
    expect(link).toHaveAttribute('href', 'https://connect.composio.dev/link/lk_x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
    expect(link.getAttribute('rel')).toMatch(/noreferrer/)
    expect(link.textContent).toContain('Connect Gmail')
  })

  it('keeps an ordinary link as an anchor, not a button', () => {
    render(<Markdown text="See [docs](https://example.com/x)." />)
    const link = screen.getByRole('link', { name: /^docs/ })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://example.com/x')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
