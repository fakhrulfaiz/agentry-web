/**
 * Human copy for a schedule's timing: "Weekdays at 8:00 AM", "Every Friday at
 * 4:00 PM", "Once on Nov 12, 2026 at 7:00 AM". Wall-clock times stay in the
 * zone the rule stores; an absolute instant uses `timeZone` (the caller's zone
 * by default).
 */
import type { ScheduleTiming } from '@/api/types'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** The parts of a stored `HH:mm[:ss[.SSS]]` time, in UTC so formatting does not shift it. */
function clockFromTime(time: string, locale: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const date = new Date(Date.UTC(2000, 0, 1, hours || 0, minutes || 0))
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

function clockFromInstant(instant: string, locale: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(instant))
}

function dateFromInstant(instant: string, locale: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(instant))
}

function every(seconds: number): string {
  if (seconds === 3600) return 'Every hour'
  if (seconds % 60 === 0) return `Every ${seconds / 60} minutes`
  return `Every ${seconds} seconds`
}

function after(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return `Once, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} from now`
  }
  return `Once, ${seconds} seconds from now`
}

function days(weekdays: readonly number[]): string {
  const names = [...new Set(weekdays)].sort((a, b) => a - b).map((day) => `${WEEKDAYS[day - 1] ?? '?'}s`)
  if (names.length <= 1) return names[0] ?? 'No days'
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Cron numbers name Sunday = 0 … Saturday = 6 (7 sometimes Sunday, too); ISO names Monday = 1. */
const CRON_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** `0`/`SUN` … `6`/`SAT` cron token to an ISO weekday, or null when it is not a single day. */
function cronDayField(token: string): number | null {
  const name = CRON_WEEKDAYS.findIndex((short) => short.toLowerCase() === token.trim().toLowerCase())
  if (name >= 0) return name === 0 ? 7 : name
  const number = Number(token)
  // `Jan`-style names are never valid in the weekday field; a non-number here means a specific day we cannot read.
  if (!Number.isInteger(number)) return null
  if (number < 0 || number > 7) return null
  return number === 0 || number === 7 ? 7 : number
}

/** Expands a cron day-of-week field (`*`, `1`, `1-5`, `MON`, `WED,FRI`) to ISO weekdays; empty for `*`, null when unsupported. */
function cronWeekdays(field: string): number[] | null {
  const trimmed = field.trim()
  if (trimmed === '*' || trimmed === '?') return []
  const out = new Set<number>()
  for (const part of trimmed.split(',')) {
    const [from, to = from] = part.split('-')
    const start = cronDayField(from)
    const end = cronDayField(to)
    if (start === null || end === null || start > end) return null
    for (let day = start; day <= end; day += 1) out.add(day)
  }
  return [...out].sort((a, b) => a - b)
}

/** `30 8 * * 1-5`-style clock fields to the stored `HH:mm` copy feed. */
function cronClock(hourField: string, minuteField: string): string | null {
  const hour = Number(hourField)
  const minute = Number(minuteField)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * The daily/weekday/every-N slice of cron grammar, so an agent-authored
 * `0 8 * * 1-5` reads like a built rule. Day-of-month, months, hour lists and
 * anything else this cannot say come back null and stay "Custom schedule".
 */
function describeCronExpression(expression: string, locale: string): string | null {
  let fields = expression.trim().split(/\s+/)
  // Six-field expressions with a leading seconds field: read only `0 …` seconds.
  if (fields.length === 6 && fields[0] === '0') fields = fields.slice(1)
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (month !== '*' || dayOfMonth !== '*') return null

  if (hour === '*' && dayOfWeek === '*') {
    if (minute === '*') return 'Every minute'
    const step = minute.startsWith('*/') ? Number(minute.slice(2)) : null
    if (step !== null && Number.isInteger(step) && step >= 1 && step <= 60) {
      return step === 1 ? 'Every minute' : `Every ${step} minutes`
    }
    return null
  }

  const weekdays = cronWeekdays(dayOfWeek)
  if (weekdays === null) return null

  const hourStep = hour.startsWith('*/') ? Number(hour.slice(2)) : null
  if (hourStep !== null && minute === '0' && Number.isInteger(hourStep) && hourStep >= 1 && hourStep <= 24) {
    return hourStep === 1 ? 'Every hour' : `Every ${hourStep} hours`
  }

  const clock = cronClock(hour, minute)
  if (clock === null) return null
  // `*` in the weekday field, or a rule whose day set spans the whole week.
  if (weekdays.length === 0 || weekdays.length === 7) return `Daily at ${clockFromTime(clock, locale)}`
  if (weekdays.length === 5 && weekdays[0] === 1 && weekdays[4] === 5) {
    return `Weekdays at ${clockFromTime(clock, locale)}`
  }
  if (weekdays.length === 1) return `Every ${WEEKDAYS[weekdays[0] - 1]} at ${clockFromTime(clock, locale)}`
  return `${days(weekdays)} at ${clockFromTime(clock, locale)}`
}

export function describeTiming(timing: ScheduleTiming, locale = 'en-US', timeZone?: string): string {
  switch (timing.kind) {
    case 'daily':
      return `Daily at ${clockFromTime(timing.daily.time, locale)}`
    case 'weekly': {
      const [first, ...rest] = [...new Set(timing.weekly.weekdays)].sort((a, b) => a - b)
      const when =
        first === undefined
          ? 'No days'
          : rest.length === 0
            ? `Every ${WEEKDAYS[first - 1] ?? '?'}`
            : rest.length === 4 && first === 1 && rest.every((day, index) => day === index + 2)
              ? 'Weekdays'
              : days(timing.weekly.weekdays)
      return `${when} at ${clockFromTime(timing.weekly.time, locale)}`
    }
    case 'every':
      return every(timing.every_seconds)
    case 'after':
      return after(timing.after_seconds)
    case 'at':
      return `Once on ${dateFromInstant(timing.at, locale, timeZone)} at ${clockFromInstant(timing.at, locale, timeZone)}`
    case 'cron': {
      const copy = describeCronExpression(timing.cron.expression, locale)
      if (copy !== null) return copy
      return 'Custom schedule'
    }
    case 'rrule':
      return 'Custom schedule'
  }
}
