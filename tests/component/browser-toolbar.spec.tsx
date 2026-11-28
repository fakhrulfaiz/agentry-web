// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAddress } from '@/ui/preview/browser-address'
import { BrowserToolbar, type BrowserToolbarProps } from '@/ui/preview/BrowserToolbar'

const base: BrowserToolbarProps = {
  address: null,
  statusText: 'Live',
  isLive: true,
  running: false,
  controlStatus: 'off',
  onTake: () => {},
  onHandBack: () => {},
}

function show(props: Partial<BrowserToolbarProps> = {}) {
  return render(<BrowserToolbar {...base} {...props} />)
}

afterEach(() => cleanup())

describe('Browser toolbar', () => {
  it('shows the security state, the full address and a link for a web page', () => {
    show({ address: parseAddress('https://example.com/a?q=1') })
    expect(screen.getByTestId('browser-address-icon')).toHaveAttribute('data-secure', 'true')
    const address = screen.getByTestId('browser-address')
    expect(within(address).getByText('example.com')).toBeInTheDocument()
    expect(within(address).getByText('/a?q=1')).toBeInTheDocument()
    const link = within(screen.getByTestId('browser-toolbar')).getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/a?q=1')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keeps a long address on one line and never duplicates the address field', () => {
    const host = `${'long'.repeat(60)}.com`
    const rest = `/${'x'.repeat(200)}`
    show({ address: parseAddress(`https://${host}${rest}`) })
    const fields = screen.getAllByTestId('browser-address')
    expect(fields).toHaveLength(1)
    expect(fields[0]!.textContent).toBe(`${host}${rest}`)
  })

  it('keeps the page title in the address tooltip without replacing the URL', () => {
    show({ address: parseAddress('https://example.com/a?q=1'), ...({ title: 'Example page' } as unknown as Partial<BrowserToolbarProps>) })
    const address = screen.getByTestId('browser-address')
    expect(address).toHaveAttribute('aria-label', 'Example page: example.com/a?q=1')
    expect(address).toHaveTextContent('example.com/a?q=1')
  })

  it('shows a non-web address as text without an external link', () => {
    show({ address: parseAddress('about:blank') })
    expect(screen.getByTestId('browser-address-icon')).toHaveAttribute('data-secure', 'false')
    expect(screen.getByTestId('browser-address')).toHaveTextContent('about:blank')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('takes and hands back control from the same row', async () => {
    const user = userEvent.setup()
    const onTake = vi.fn()
    const onHandBack = vi.fn()
    const { rerender } = show({ onTake, onHandBack })
    await user.click(screen.getByRole('button', { name: 'Take control' }))
    expect(onTake).toHaveBeenCalledTimes(1)

    rerender(<BrowserToolbar {...base} onTake={onTake} onHandBack={onHandBack} controlStatus="taking" statusText="Taking control" />)
    const taking = screen.getByRole('button', { name: 'Hand back' })
    expect(taking).toHaveAttribute('aria-disabled', 'true')

    rerender(<BrowserToolbar {...base} onTake={onTake} onHandBack={onHandBack} controlStatus="on" statusText="You have control" />)
    await user.click(screen.getByRole('button', { name: 'Hand back' }))
    expect(onHandBack).toHaveBeenCalledTimes(1)

    rerender(<BrowserToolbar {...base} onTake={onTake} onHandBack={onHandBack} controlStatus="held" statusText="You have control in another tab" />)
    await user.click(screen.getByRole('button', { name: 'Take control here' }))
    expect(onTake).toHaveBeenCalledTimes(2)
  })

  it('shows a spinner while the browser is working', () => {
    show({ running: true })
    expect(screen.getByLabelText('The browser is working')).toBeInTheDocument()
  })
})
