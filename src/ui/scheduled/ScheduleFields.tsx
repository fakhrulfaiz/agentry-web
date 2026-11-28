/**
 * The task form shared by the detail page's Edit drawer and the New task page:
 * name, instruction, an optional slot under the instruction, and the Repeat card
 * (frequency, interval, weekdays, date, time, cron, time zone). Validation of
 * the timing happens where the values are saved, through `formToTiming`.
 */
import { Card } from '@astryxdesign/core/Card'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TimeInput } from '@astryxdesign/core/TimeInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'
import type { ISODateString, ISOTimeString } from '@astryxdesign/core/utils'
import { FREQUENCIES, browserTimeZone, type Frequency, type ScheduleFormValues } from '@/schedule/form'

const WEEKDAYS: { value: number; label: string; name: string }[] = [
  { value: 1, label: 'Mon', name: 'Monday' },
  { value: 2, label: 'Tue', name: 'Tuesday' },
  { value: 3, label: 'Wed', name: 'Wednesday' },
  { value: 4, label: 'Thu', name: 'Thursday' },
  { value: 5, label: 'Fri', name: 'Friday' },
  { value: 6, label: 'Sat', name: 'Saturday' },
  { value: 7, label: 'Sun', name: 'Sunday' },
]
const ZONE_FIELDS: Frequency[] = ['daily', 'weekly', 'weekdays', 'custom', 'once']
const TIMED_FIELDS: Frequency[] = ['daily', 'weekly', 'weekdays', 'once']
/** Kinds that show the DeepSeek-style Interval step row (`every_seconds` rules). */
const INTERVAL_FIELDS: Frequency[] = ['minutes', 'hourly']

/** Every IANA zone, best effort; the browser's zone is offered first. */
function timeZoneChoices(): string[] {
  const system = browserTimeZone()
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  return [system, 'UTC', ...zones.filter((zone) => zone !== system && zone !== 'UTC')]
}

export interface ScheduleFieldErrors {
  title?: string
  prompt?: string
}

export function ScheduleFields({
  values,
  onChange,
  errors,
  afterPrompt,
}: {
  values: ScheduleFormValues
  onChange: (patch: Partial<ScheduleFormValues>) => void
  errors?: ScheduleFieldErrors
  /** Extra rows between the instruction and the Repeat card. */
  afterPrompt?: ReactNode
}) {
  const zoneLabel = (zone: string) => (zone === browserTimeZone() ? `${zone} (system)` : zone)
  const frequencyLabel = FREQUENCIES.find((f) => f.value === values.frequency)?.label ?? ''
  return (
    <>
      
          <VStack gap={3}>
            <TextInput
              label="Task name"
              value={values.title}
              status={errors?.title ? { type: 'error', message: errors.title } : undefined}
              onChange={(title) => onChange({ title })}
            />
            <TextArea
              label="Task instruction"
              status={errors?.prompt ? { type: 'error', message: errors.prompt } : undefined}
              value={values.prompt}
              onChange={(prompt) => onChange({ prompt })}
            />
          </VStack>
      {afterPrompt}
          <Card padding={0}>
            <VStack gap={0}>
              <HStack gap={3} vAlign="center" justify="between" padding={3}>
                <Text weight="medium">Repeat</Text>
                <DropdownMenu
                  button={{ label: frequencyLabel, size: 'sm' }}
                  items={FREQUENCIES.map((f) => ({
                    label: f.label,
                    isDisabled: f.value === values.frequency,
                    onClick: () => onChange({ frequency: f.value }),
                  }))}
                />
              </HStack>
              {INTERVAL_FIELDS.includes(values.frequency) && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Interval</Text>
                    <NumberInput
                      label="Interval"
                      isLabelHidden
                      width="auto"
                      value={values.interval}
                      min={1}
                      step={1}
                      onChange={(next) => onChange({ interval: Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1 })}
                    />
                  </HStack>
                </>
              )}
              {values.frequency === 'weekly' && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Weekday</Text>
                    <HStack gap={1} wrap="wrap">
                      {WEEKDAYS.map((day) => (
                        <ToggleButton
                          key={day.value}
                          label={day.label}
                          size="sm"
                          isPressed={values.weekdays.includes(day.value)}
                          onPressedChange={() =>
                            onChange({
                              weekdays:
                                values.weekdays.includes(day.value) && values.weekdays.length > 1
                                  ? values.weekdays.filter((one) => one !== day.value)
                                  : [...values.weekdays, day.value].sort((a, b) => a - b),
                            })
                          }
                        />
                      ))}
                    </HStack>
                  </HStack>
                </>
              )}
              {values.frequency === 'weekdays' && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Weekday</Text>
                    <HStack gap={1}>
                      {WEEKDAYS.slice(0, 5).map((day) => (
                        <ToggleButton key={day.value} label={day.label} size="sm" isPressed isDisabled />
                      ))}
                    </HStack>
                  </HStack>
                </>
              )}
              {values.frequency === 'once' && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Date</Text>
                    <DateInput
                      label="Date"
                      isLabelHidden
                      value={values.date ? (values.date as ISODateString) : undefined}
                      onChange={(date) => date && onChange({ date })}
                    />
                  </HStack>
                </>
              )}
              {TIMED_FIELDS.includes(values.frequency) && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Time</Text>
                    <TimeInput
                      label="Time"
                      isLabelHidden
                      width="auto"
                      value={values.time as ISOTimeString}
                      onChange={(time) => time && onChange({ time })}
                    />
                  </HStack>
                </>
              )}
              {values.frequency === 'custom' && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Cron expression</Text>
                    <TextInput
                      label="Cron expression"
                      isLabelHidden
                      width="auto"
                      value={values.cron}
                      onChange={(cron) => onChange({ cron })}
                    />
                  </HStack>
                </>
              )}
              {ZONE_FIELDS.includes(values.frequency) && (
                <>
                  <Divider />
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Time zone</Text>
                    <DropdownMenu
                      button={{ label: zoneLabel(values.timeZone), size: 'sm' }}
                      alignment="end"
                      items={timeZoneChoices().map((zone) => ({
                        label: zoneLabel(zone),
                        isDisabled: zone === values.timeZone,
                        onClick: () => onChange({ timeZone: zone }),
                      }))}
                    />
                  </HStack>
                </>
              )}
            </VStack>
          </Card>
    </>
  )
}
