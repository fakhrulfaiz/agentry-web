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
      return every(timing.every.every_seconds)
    case 'after':
      return after(timing.after.after_seconds)
    case 'at':
      return `Once on ${dateFromInstant(timing.at, locale, timeZone)} at ${clockFromInstant(timing.at, locale, timeZone)}`
    case 'cron':
    case 'rrule':
      return 'Custom schedule'
  }
}
