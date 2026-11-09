import { describe, expect, it } from 'vitest'
import type { AgentSchedule, ScheduleTiming } from '@/api/types'
import {
  browserTimeZone,
  EMPTY_FORM,
  formToTiming,
  type ScheduleFormValues,
  ScheduleFormError,
  timingToForm,
} from '@/schedule/form'

const values = (patch: Partial<ScheduleFormValues> = {}): ScheduleFormValues => ({
  ...EMPTY_FORM,
  timeZone: 'UTC',
  ...patch,
})

const schedule = (timing: ScheduleTiming): AgentSchedule => ({
  id: 's1',
  object: 'agent.schedule',
  title: 'T',
  prompt: 'P',
  timing,
  status: 'active',
  next_run_at: null,
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-09T00:00:00.000Z',
  revision: 'r1',
  session_id: 'sesn_1',
  running: false,
  last_run: null,
})

describe('formToTiming', () => {
  it('compiles hourly to a one-hour every rule', () => {
    expect(formToTiming(values({ frequency: 'hourly' }))).toEqual({ kind: 'every', every: { every_seconds: 3600 } })
  })

  it('compiles daily with a normalized time and the chosen zone', () => {
    expect(formToTiming(values({ frequency: 'daily', time: '9:30', timeZone: 'Asia/Tokyo' }))).toEqual({
      kind: 'daily',
      daily: { time: '09:30:00.000', time_zone: 'Asia/Tokyo' },
    })
  })

  it('compiles weekdays and weekly', () => {
    expect(formToTiming(values({ frequency: 'weekdays' }))).toEqual({
      kind: 'weekly',
      weekly: { time: '09:00:00.000', time_zone: 'UTC', weekdays: [1, 2, 3, 4, 5] },
    })
    expect(formToTiming(values({ frequency: 'weekly', time: '16:00', weekdays: [4, 2] }))).toEqual({
      kind: 'weekly',
      weekly: { time: '16:00:00.000', time_zone: 'UTC', weekdays: [4, 2] },
    })
  })

  it('rejects a weekly rule with no days', () => {
    expect(() => formToTiming(values({ frequency: 'weekly', weekdays: [] }))).toThrow(ScheduleFormError)
    try {
      formToTiming(values({ frequency: 'weekly', weekdays: [] }))
    } catch (error) {
      expect((error as ScheduleFormError).code).toBe('invalid_rule')
    }
  })

  it('compiles a future once date to a UTC instant', () => {
    expect(formToTiming(values({ frequency: 'once', date: '2099-01-02', time: '15:45', timeZone: 'America/New_York' }))).toEqual({
      kind: 'at',
      at: '2099-01-02T20:45:00.000Z',
    })
  })

  it('rejects a once date in the past', () => {
    try {
      formToTiming(values({ frequency: 'once', date: '2020-01-02', time: '15:45' }))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleFormError)
      expect((error as ScheduleFormError).code).toBe('not_future')
    }
  })

  it('rejects a wall time that does not exist in the zone', () => {
    try {
      formToTiming(values({ frequency: 'once', date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' }))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleFormError)
      expect((error as ScheduleFormError).code).toBe('invalid_rule')
    }
  })

  it('rejects an empty or missing once date', () => {
    for (const date of ['', 'not-a-date']) {
      try {
        formToTiming(values({ frequency: 'once', date }))
        throw new Error('expected a rejection')
      } catch (error) {
        expect((error as ScheduleFormError).code).toBe('invalid_rule')
      }
    }
  })

  it('compiles a custom cron expression and rejects an empty one', () => {
    expect(formToTiming(values({ frequency: 'custom', cron: '0 9 * * 1-5', timeZone: 'Europe/London' }))).toEqual({
      kind: 'cron',
      cron: { expression: '0 9 * * 1-5', time_zone: 'Europe/London' },
    })
    try {
      formToTiming(values({ frequency: 'custom', cron: '  ' }))
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ScheduleFormError).code).toBe('invalid_rule')
    }
  })
})

describe('timingToForm', () => {
  const base = values({ title: 'Keep me', prompt: 'And me', model: 'mock-model', timeZone: 'Asia/Tokyo' })

  it.each<[string, ScheduleTiming, Partial<ScheduleFormValues>]>([
    [
      'daily',
      { kind: 'daily', daily: { time: '09:30:00.000', time_zone: 'Asia/Tokyo' } },
      { frequency: 'daily', time: '09:30' },
    ],
    [
      'weekdays',
      { kind: 'weekly', weekly: { time: '08:00:00.000', time_zone: 'Asia/Tokyo', weekdays: [1, 2, 3, 4, 5] } },
      { frequency: 'weekdays', time: '08:00', weekdays: [1, 2, 3, 4, 5] },
    ],
    [
      'weekly',
      { kind: 'weekly', weekly: { time: '16:00:00.000', time_zone: 'Asia/Tokyo', weekdays: [2, 4] } },
      { frequency: 'weekly', time: '16:00', weekdays: [2, 4] },
    ],
    ['hourly', { kind: 'every', every: { every_seconds: 3600 } }, { frequency: 'hourly' }],
    ['custom', { kind: 'cron', cron: { expression: '0 9 * * *', time_zone: 'Asia/Tokyo' } }, { frequency: 'custom', cron: '0 9 * * *' }],
  ])('round-trips %s', (_name, timing, expected) => {
    expect(timingToForm(timing, base)).toMatchObject({ title: 'Keep me', prompt: 'And me', model: 'mock-model', ...expected })
  })

  it('converts a once instant into the base zone', () => {
    const form = timingToForm({ kind: 'at', at: '2026-11-12T20:45:00.000Z' }, base)
    expect(form).toMatchObject({ frequency: 'once', date: '2026-11-13', time: '05:45' })
  })

  it('does not throw for kinds the form cannot edit', () => {
    expect(timingToForm({ kind: 'after', after: { after_seconds: 60 } }, base)).toMatchObject({ frequency: 'custom', timeZone: 'Asia/Tokyo' })
    expect(timingToForm({ kind: 'rrule', rrule: { rrule: 'RRULE:FREQ=DAILY' } }, base)).toMatchObject({ frequency: 'custom', timeZone: 'Asia/Tokyo' })
  })

  it('round-trips every timing formToTiming emits', () => {
    for (const form of [
      values({ frequency: 'daily' }),
      values({ frequency: 'weekdays' }),
      values({ frequency: 'weekly', weekdays: [3, 5] }),
      values({ frequency: 'hourly' }),
      values({ frequency: 'custom', cron: '0 9 * * 1-5' }),
    ]) {
      const timing = formToTiming(form)
      expect(formToTiming(timingToForm(timing, form))).toEqual(timing)
    }
  })

  it('keeps the record fields it was given', () => {
    const timing: ScheduleTiming = { kind: 'daily', daily: { time: '09:00:00.000', time_zone: 'UTC' } }
    const form = timingToForm(timing, base)
    expect(form.timeZone).toBe(timing.daily.time_zone)
  })
})

describe('browserTimeZone', () => {
  it('returns the zone the browser reports', () => {
    expect(typeof browserTimeZone()).toBe('string')
    expect(browserTimeZone().length).toBeGreaterThan(0)
  })

  it('is referenced by the edit prefill of a saved schedule', () => {
    const form = timingToForm(schedule({ kind: 'daily', daily: { time: '09:00:00.000', time_zone: 'UTC' } }).timing, {
      ...EMPTY_FORM,
      timeZone: browserTimeZone(),
    })
    expect(form.frequency).toBe('daily')
  })
})
