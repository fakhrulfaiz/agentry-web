import { browserTimeZone } from './form'

/** The composer text a new chat starts with after "Create with chat" on the Scheduled page (`/?schedule=1`). */
export function scheduleSeedText(timeZone: string = browserTimeZone()): string {
  return `Set up a scheduled task: [what it should do and when it should run]. My time zone is ${timeZone}.`
}
