/** Starter tasks offered on the Scheduled page; picking one opens the create form prefilled. */
import { EMPTY_FORM, type Frequency, type ScheduleFormValues } from './form'

export interface ScheduleTemplate {
  id: 'daily-briefing' | 'weekly-review' | 'monitor-topic' | 'content-ideas'
  title: string
  description: string
  prompt: string
  frequency: Frequency
  time: string
  weekdays?: number[]
}

export const TEMPLATES: readonly ScheduleTemplate[] = [
  {
    id: 'daily-briefing',
    title: 'Daily briefing',
    description: 'A morning digest of what changed and what needs you today.',
    prompt:
      'Every weekday morning, put together a short briefing for me: anything new I should read, decisions waiting on me, and the three things worth doing first today. Keep it under 300 words and end with one question I should answer.',
    frequency: 'weekdays',
    time: '08:00',
  },
  {
    id: 'weekly-review',
    title: 'Weekly review',
    description: 'A Friday wrap-up of the week and a plan for the next one.',
    prompt:
      'Every Friday afternoon, review my week: what I finished, what slipped, and what I said I would do next. Point out anything I keep postponing and suggest a realistic plan for Monday. Be direct and short.',
    frequency: 'weekly',
    time: '16:00',
    weekdays: [5],
  },
  {
    id: 'monitor-topic',
    title: 'Monitor a topic',
    description: 'A daily check-in on changes in a topic you care about.',
    prompt:
      'Every morning, check for meaningful news or changes in the topic I care about, skip anything repetitive, and tell me only what is genuinely new. If nothing important happened, say so in one line.',
    frequency: 'daily',
    time: '09:00',
  },
  {
    id: 'content-ideas',
    title: 'Content ideas',
    description: 'A Monday idea drop for what to write or record next.',
    prompt:
      'Every Monday morning, suggest three concrete content ideas I could write or record this week. For each one give the angle, the audience, and one opening line. Prefer ideas that build on what I published recently.',
    frequency: 'weekly',
    time: '09:00',
    weekdays: [1],
  },
] as const

/** The template's values in the caller's time zone; the model stays for the form to fill. */
export function templateValues(template: ScheduleTemplate, timeZone: string): ScheduleFormValues {
  return {
    ...EMPTY_FORM,
    title: template.title,
    prompt: template.prompt,
    frequency: template.frequency,
    time: template.time,
    weekdays: template.weekdays ?? EMPTY_FORM.weekdays,
    timeZone,
    model: '',
  }
}
