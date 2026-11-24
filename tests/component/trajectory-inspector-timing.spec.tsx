// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TrajectoryRecord } from '@/ui/trajectory/build-trajectory'
import { Inspector } from '@/ui/trajectory/Inspector'
import { spanDetails } from '@/ui/trajectory/Overview'

afterEach(cleanup)

const step: TrajectoryRecord = {
  id: 'item_msg_4', kind: 'assistant', chatItemId: 'item_msg_4', turnId: 'turn_1', status: 'completed', title: 'looking', step: 1,
  startedAt: 10.1, firstTokenAt: 10.4, endedAt: 10.9,
  usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 120 },
}

describe('trajectory timing details', () => {
  it('shows time to first token, generation and throughput for a timed step', () => {
    render(<Inspector record={step} onShowInChat={() => {}} />)
    const timing = within(screen.getByRole('region', { name: 'Timing' }))
    expect(timing.getByText('800 ms', { selector: 'span' })).toBeInTheDocument()
    expect(timing.getByText('300 ms')).toBeInTheDocument()
    expect(timing.getByText('500 ms')).toBeInTheDocument()
    expect(timing.getByText('40 tok/s')).toBeInTheDocument()
  })

  it('says what was not recorded for a step without first-token time', () => {
    render(<Inspector record={{ ...step, firstTokenAt: undefined }} onShowInChat={() => {}} />)
    const timing = within(screen.getByRole('region', { name: 'Timing' }))
    expect(timing.getAllByText('Not recorded').length).toBe(2)
  })

  it('hover text of an assistant span splits waiting from generating', () => {
    expect(spanDetails({ id: 'x', lane: 'assistant', label: 'Step 1', start: 10.1, firstToken: 10.4, end: 10.9, status: 'completed' })).toMatch(/Step 1 · Started .* · First token 300 ms · Generating 500 ms · Total 800 ms/)
  })
})
