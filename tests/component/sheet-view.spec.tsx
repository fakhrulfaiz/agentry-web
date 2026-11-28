// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererBody } from '@/ui/preview/renderers'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  build(wb)
  const data = await wb.xlsx.writeBuffer()
  return new Uint8Array(data as ArrayBuffer)
}

describe('RendererBody sheet', () => {
  it('renders sheet tabs and cell values for a workbook', async () => {
    const bytes = await workbookBuffer((wb) => {
      const ws1 = wb.addWorksheet('First')
      ws1.addRow(['Name', 'Value'])
      ws1.addRow(['Alpha', 1])
      const ws2 = wb.addWorksheet('Second')
      ws2.addRow(['Other'])
      ws2.addRow(['Beta'])
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as unknown as BodyInit, { status: 200 })))
    render(<RendererBody id="sheet" sessionId="s1" path="report.xlsx" reloadKey={0} wrap runScripts={false} />)
    await screen.findByRole('tab', { name: 'First' })
    expect(screen.getByRole('tab', { name: 'Second' })).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Second' }))
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('shows a truncation banner when rows exceed the cap', async () => {
    const bytes = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet('Big')
      ws.addRow(['N'])
      for (let i = 0; i < 2001; i++) ws.addRow([i])
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as unknown as BodyInit, { status: 200 })))
    render(<RendererBody id="sheet" sessionId="s1" path="big.xlsx" reloadKey={0} wrap runScripts={false} />)
    await screen.findByText(/Showing the first 2000 rows/)
  })

  it('shows a parse error banner with download fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-a-zip', { status: 200 })))
    render(<RendererBody id="sheet" sessionId="s1" path="bad.xlsx" reloadKey={0} wrap runScripts={false} />)
    await screen.findByText('Could not read this spreadsheet.')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/agentry/agents/sessions/s1/artifacts/bad.xlsx?download=1')
  })
})
