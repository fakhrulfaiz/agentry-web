/**
 * The form model and its compiler to DSH's `timing` union. Wall-clock times are
 * stored as `HH:mm:00.000`; a `once` date is converted from the chosen zone to
 * a UTC instant, refusing wall times the zone skips (DST) and past dates.
 */
import type { ScheduleTiming } from '@/api/types'

export type Frequency = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'

export const FREQUENCIES: readonly { value: Frequency; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
] as const

export interface ScheduleFormValues {
  title: string
  prompt: string
  frequency: Frequency
  /** `YYYY-MM-DD`, used by `once` only. */
  date: string
  /** `HH:mm`, used by every kind except hourly. */
  time: string
  /** ISO weekdays, Monday = 1 … Sunday = 7. */
  weekdays: number[]
  cron: string
  timeZone: string
  model: string
}

export const EMPTY_FORM: ScheduleFormValues = {
  title: '',
  prompt: '',
  frequency: 'daily',
  date: '',
  time: '09:00',
  weekdays: [1, 2, 3, 4, 5],
  cron: '',
  timeZone: '',
  model: '',
}

/** A field-level refusal the form shows inline; `code` matches the backend's error codes where it has one. */
export class ScheduleFormError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ScheduleFormError'
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `9:30` → `09:30:00.000`; `09:30:00.000` stays as it is. */
function normalizeTime(time: string): string {
  const [hours, minutes] = time.split(':')
  const hh = Number(hours)
  const mm = Number(minutes)
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new ScheduleFormError('invalid_rule', 'Enter a time of day.')
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000`
}

/** The zone's offset from UTC at the given instant, in milliseconds. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(utcMs))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - utcMs
}

/** The wall time `date`+`time` in `timeZone`, as UTC. Throws `invalid_rule` when the zone skips it. */
function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  if (![year, month, day, hours, minutes].every(Number.isInteger)) {
    throw new ScheduleFormError('invalid_rule', 'Enter a date.')
  }
  const wall = Date.UTC(year, month - 1, day, hours, minutes)
  // Two passes settle the offset on either side of a DST change.
  let guess = wall - zoneOffsetMs(wall, timeZone)
  guess = wall - zoneOffsetMs(guess, timeZone)
  const actual = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})
  const matches =
    Number(actual.year) === year &&
    Number(actual.month) === month &&
    Number(actual.day) === day &&
    Number(actual.hour) % 24 === hours &&
    Number(actual.minute) === minutes
  if (!matches) throw new ScheduleFormError('invalid_rule', 'That time does not exist in this time zone.')
  return new Date(guess)
}

export function formToTiming(values: ScheduleFormValues): ScheduleTiming {
  switch (values.frequency) {
    case 'hourly':
      return { kind: 'every', every: { every_seconds: 3600 } }
    case 'daily':
      return { kind: 'daily', daily: { time: normalizeTime(values.time), time_zone: values.timeZone } }
    case 'weekdays':
      return {
        kind: 'weekly',
        weekly: { time: normalizeTime(values.time), time_zone: values.timeZone, weekdays: [1, 2, 3, 4, 5] },
      }
    case 'weekly':
      if (values.weekdays.length === 0) throw new ScheduleFormError('invalid_rule', 'Choose at least one day.')
      return {
        kind: 'weekly',
        weekly: { time: normalizeTime(values.time), time_zone: values.timeZone, weekdays: [...values.weekdays] },
      }
    case 'custom': {
      const expression = values.cron.trim()
      if (expression === '') throw new ScheduleFormError('invalid_rule', 'Enter a cron expression.')
      return { kind: 'cron', cron: { expression, time_zone: values.timeZone } }
    }
    case 'once': {
      const at = zonedToUtc(values.date, values.time, values.timeZone)
      if (at.getTime() <= Date.now()) throw new ScheduleFormError('not_future', 'Choose a time in the future.')
      return { kind: 'at', at: at.toISOString() }
    }
  }
}

/** `HH:mm:00.000` → `HH:mm`. */
const fromStoredTime = (time: string): string => time.slice(0, 5)

function instantToZone(instant: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(new Date(instant))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})
  const hour = String(Number(parts.hour) % 24).padStart(2, '0')
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  }
}

const isWeekdays = (weekdays: readonly number[]): boolean =>
  weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => weekdays.includes(day))

/** Fills the timing fields from `timing` over `base`; kinds the form cannot edit become `custom`. */
export function timingToForm(timing: ScheduleTiming, base: ScheduleFormValues): ScheduleFormValues {
  switch (timing.kind) {
    case 'daily':
      return {
        ...base,
        frequency: 'daily',
        time: fromStoredTime(timing.daily.time),
        timeZone: timing.daily.time_zone,
      }
    case 'weekly':
      return {
        ...base,
        frequency: isWeekdays(timing.weekly.weekdays) ? 'weekdays' : 'weekly',
        time: fromStoredTime(timing.weekly.time),
        weekdays: [...timing.weekly.weekdays],
        timeZone: timing.weekly.time_zone,
      }
    case 'every':
      return timing.every.every_seconds === 3600 ? { ...base, frequency: 'hourly' } : { ...base, frequency: 'custom', cron: '' }
    case 'cron':
      return { ...base, frequency: 'custom', cron: timing.cron.expression, timeZone: timing.cron.time_zone }
    case 'at': {
      const zone = base.timeZone || browserTimeZone()
      const { date, time } = instantToZone(timing.at, zone)
      return { ...base, frequency: 'once', date, time, timeZone: zone }
    }
    case 'after':
    case 'rrule':
      return { ...base, frequency: 'custom', cron: '' }
  }
}
