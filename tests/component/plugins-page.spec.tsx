// @vitest-environment jsdom
import '../helpers/dom'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/settings',
}))

import { PluginsPage } from '@/ui/plugins/PluginsPage'
import { SettingsNav } from '@/ui/settings/SettingsNav'

afterEach(() => {
  cleanup()
  replace.mockReset()
})

describe('PluginsPage', () => {
  it('renders Connectors tab by default', () => {
    render(<PluginsPage tab="connectors" connectors={<p>dir</p>} skills={<p>sk</p>} />)
    expect(screen.getByRole('button', { name: 'Connectors' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('dir')).toBeInTheDocument()
    expect(screen.queryByText('sk')).toBeNull()
  })

  it('switching to Skills updates the URL', async () => {
    const user = userEvent.setup()
    render(<PluginsPage tab="connectors" connectors={<p>dir</p>} skills={<p>sk</p>} />)
    await user.click(screen.getByRole('button', { name: 'Skills' }))
    expect(replace).toHaveBeenCalledWith('/plugins?tab=skills')
    expect(screen.getByText('sk')).toBeInTheDocument()
  })

  it('settings nav has no Connectors entry', () => {
    render(<SettingsNav />)
    expect(screen.queryByRole('link', { name: 'Connectors' })).toBeNull()
  })
})
