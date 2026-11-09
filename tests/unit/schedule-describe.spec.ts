import { describe, expect, it } from 'vitest'
import type { ScheduleTiming } from '@/api/types'
import { describeTiming } from '@/schedule/describe'

const weekly = (time: string, weekdays: number[]): ScheduleTiming => ({
  kind: 'weekly',
  weekly: { time, time_zone: 'UTC', weekdays },
})

describe('describeTiming', () => {
  it.each<[string, ScheduleTiming, string]>([
    ['weekdays', weekly('08:00:00.000', [1, 2, 3, 4, 5]), 'Weekdays at 8:00 AM'],
    ['one weekday', weekly('16:00:00.000', [5]), 'Every Friday at 4:00 PM'],
    ['two weekdays', weekly('09:00:00.000', [1, 3]), 'Mondays and Wednesdays at 9:00 AM'],
    ['three weekdays', weekly('09:00:00.000', [1, 3, 5]), 'Mondays, Wednesdays and Fridays at 9:00 AM'],
    ['daily', { kind: 'daily', daily: { time: '09:00:00.000', time_zone: 'UTC' } }, 'Daily at 9:00 AM'],
    ['every hour', { kind: 'every', every: { every_seconds: 3600 } }, 'Every hour'],
    ['every minutes', { kind: 'every', every: { every_seconds: 900 } }, 'Every 15 minutes'],
    ['every seconds', { kind: 'every', every: { every_seconds: 90 } }, 'Every 90 seconds'],
    ['after', { kind: 'after', after: { after_seconds: 60 } }, 'Once, 1 minute from now'],
    ['cron', { kind: 'cron', cron: { expression: '0 9 * * *', time_zone: 'UTC' } }, 'Custom schedule'],
    ['rrule', { kind: 'rrule', rrule: { rrule: 'RRULE:FREQ=DAILY' } }, 'Custom schedule'],
  ])('%s', (_name, timing, expected) => {
    expect(describeTiming(timing, 'en-US')).toBe(expected)
  })

  it('shows an absolute time in the zone it was recorded in', () => {
    const timing: ScheduleTiming = { kind: 'at', at: '2026-11-12T07:00:00.000Z' }
    expect(describeTiming(timing, 'en-US', 'UTC')).toBe('Once on Nov 12, 2026 at 7:00 AM')
    expect(describeTiming(timing, 'en-US', 'America/New_York')).toBe('Once on Nov 12, 2026 at 2:00 AM')
  })

  it('accepts times with or without seconds', () => {
    const timing: ScheduleTiming = { kind: 'daily', daily: { time: '09:30', time_zone: 'UTC' } }
    expect(describeTiming(timing, 'en-US')).toBe('Daily at 9:30 AM')
  })
})
