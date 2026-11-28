'use client'

import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { colorVars } from '@astryxdesign/core/theme/tokens.stylex'
import { useEffect, useState } from 'react'
import { fileUrl } from '@/preview/use-file-bytes'

const ROW_CAP = 2000
const COL_CAP = 50

interface SheetData {
  name: string
  rows: string[][]
  totalRows: number
  totalCols: number
}

interface WorkbookData {
  sheets: SheetData[]
  truncatedRows: boolean
  truncatedCols: boolean
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: WorkbookData }
  | { status: 'missing' }
  | { status: 'error' }

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('result' in v && v.result !== null && v.result !== undefined) return cellText(v.result)
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((p) => (typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('')
    if ('hyperlink' in v && typeof v.text === 'string') return v.text
    if ('error' in v && typeof v.error === 'string') return v.error
  }
  try { return String(value) } catch { return '' }
}

async function parseWorkbook(bytes: ArrayBuffer): Promise<WorkbookData> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  let truncatedRows = false
  let truncatedCols = false
  const sheets: SheetData[] = []
  for (const ws of wb.worksheets) {
    const totalRows = ws.rowCount
    let totalCols = 0
    ws.eachRow({ includeEmpty: false }, (row) => { totalCols = Math.max(totalCols, row.cellCount) })
    if (totalRows > ROW_CAP) truncatedRows = true
    if (totalCols > COL_CAP) truncatedCols = true
    const rowLimit = Math.min(totalRows, ROW_CAP)
    const colLimit = Math.min(totalCols, COL_CAP)
    const rows: string[][] = []
    for (let r = 1; r <= rowLimit; r++) {
      const row = ws.getRow(r)
      const out: string[] = []
      for (let c = 1; c <= colLimit; c++) out.push(cellText(row.getCell(c).value))
      rows.push(out)
    }
    sheets.push({ name: ws.name || `Sheet ${sheets.length + 1}`, rows, totalRows, totalCols })
  }
  if (sheets.length === 0) sheets.push({ name: 'Sheet 1', rows: [], totalRows: 0, totalCols: 0 })
  return { sheets, truncatedRows, truncatedCols }
}

export function SheetView({ sessionId, path, reloadKey, onMissing, onRetry }: {
  sessionId: string; path: string; reloadKey: number; onMissing?: () => void; onRetry?: () => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [sheetIndex, setSheetIndex] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setSheetIndex(0)
    ;(async () => {
      const res = await fetch(fileUrl(sessionId, path), { signal: controller.signal })
      if (res.status === 404) return setState({ status: 'missing' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await parseWorkbook(await res.arrayBuffer())
      if (!controller.signal.aborted) setState({ status: 'ok', data })
    })().catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [sessionId, path, reloadKey])

  useEffect(() => { if (state.status === 'missing') onMissing?.() }, [state.status, onMissing])

  if (state.status === 'loading') return <Skeleton height={160} />
  if (state.status === 'missing') return <Banner status="warning" title="File no longer exists." />
  if (state.status === 'error') {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Banner status="error" title="Could not read this spreadsheet." endContent={onRetry ? <Button label="Retry" onClick={onRetry} /> : undefined} />
        <div><Button label="Download" variant="secondary" href={fileUrl(sessionId, path, true)} /></div>
      </div>
    )
  }

  const { sheets, truncatedRows, truncatedCols } = state.data
  const sheet = sheets[Math.min(sheetIndex, sheets.length - 1)]!
  const truncation = truncatedRows || truncatedCols
    ? `Showing the first ${ROW_CAP} rows and ${COL_CAP} columns. Download for the full workbook.`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {truncation && <Banner status="info" title={truncation} />}
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sheets.map((s, i) => (
            <button
              key={s.name + String(i)}
              type="button"
              role="tab"
              aria-selected={i === sheetIndex}
              onClick={() => setSheetIndex(i)}
              style={{
                border: `1px solid ${colorVars['--color-border']}`,
                borderRadius: 6,
                padding: '4px 10px',
                background: i === sheetIndex ? colorVars['--color-background-muted'] : 'transparent',
                color: colorVars['--color-text-primary'],
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <Text type="supporting" color="secondary">This sheet is empty.</Text>
      ) : (
        <div style={{ overflow: 'auto', fontSize: 13 }}>
          <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const Tag = r === 0 ? 'th' : 'td'
                    return (
                      <Tag
                        key={c}
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                          borderBottom: `1px solid ${colorVars['--color-border']}`,
                          whiteSpace: 'nowrap',
                          fontWeight: r === 0 ? 600 : 400,
                        }}
                      >
                        {cell}
                      </Tag>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
