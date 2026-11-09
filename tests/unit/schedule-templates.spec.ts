import { describe, expect, it } from 'vitest'
import { formToTiming } from '@/schedule/form'
import { TEMPLATES, templateValues } from '@/schedule/templates'

describe('templates', () => {
  it('lists the four starter tasks with their schedules', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['daily-briefing', 'weekly-review', 'monitor-topic', 'content-ideas'])
    expect(TEMPLATES.map((t) => t.title)).toEqual(['Daily briefing', 'Weekly review', 'Monitor a topic', 'Content ideas'])
    expect(TEMPLATES.find((t) => t.id === 'daily-briefing')).toMatchObject({ frequency: 'weekdays', time: '08:00' })
    expect(TEMPLATES.find((t) => t.id === 'weekly-review')).toMatchObject({ frequency: 'weekly', time: '16:00', weekdays: [5] })
    expect(TEMPLATES.find((t) => t.id === 'monitor-topic')).toMatchObject({ frequency: 'daily', time: '09:00' })
    expect(TEMPLATES.find((t) => t.id === 'content-ideas')).toMatchObject({ frequency: 'weekly', time: '09:00', weekdays: [1] })
  })

  it('gives every template a prompt and a description', () => {
    for (const template of TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(10)
      expect(template.prompt.length).toBeGreaterThan(template.description.length)
    }
  })

  it('fills a form in the caller time zone', () => {
    const form = templateValues(TEMPLATES[0], 'Europe/London')
    expect(form).toMatchObject({ title: 'Daily briefing', timeZone: 'Europe/London', model: '' })
    expect(formToTiming(form)).toEqual({
      kind: 'weekly',
      weekly: { time: '08:00:00.000', time_zone: 'Europe/London', weekdays: [1, 2, 3, 4, 5] },
    })
  })

  it('round-trips every template through a valid timing', () => {
    for (const template of TEMPLATES) {
      const timing = formToTiming(templateValues(template, 'UTC'))
      expect(['daily', 'weekly']).toContain(timing.kind)
    }
  })
})
