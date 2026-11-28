'use client'

/** Manual task creation: the shared task form, prefilled from `?template=<id>` when given. */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import { goToLogin } from '@/chat/use-conversation'
import { EMPTY_FORM, ScheduleFormError, browserTimeZone, formToTiming, type ScheduleFormValues } from '@/schedule/form'
import { TEMPLATES, templateValues } from '@/schedule/templates'
import { ScheduleFields, type ScheduleFieldErrors } from '@/ui/scheduled/ScheduleFields'

export function NewSchedule({ templateId }: { templateId?: string }) {
  const router = useRouter()
  const [values, setValues] = useState<ScheduleFormValues>(() => {
    const template = TEMPLATES.find((one) => one.id === templateId)
    return template
      ? templateValues(template, browserTimeZone())
      : { ...EMPTY_FORM, timeZone: browserTimeZone() }
  })
  const [errors, setErrors] = useState<ScheduleFieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const create = async () => {
    const fieldErrors: ScheduleFieldErrors = {}
    if (values.title.trim() === '') fieldErrors.title = 'Enter a name.'
    if (values.prompt.trim() === '') fieldErrors.prompt = 'Enter an instruction.'
    setErrors(fieldErrors)
    setError(null)
    if (fieldErrors.title || fieldErrors.prompt) return
    setSaving(true)
    try {
      const created = await api.createSchedule({
        title: values.title.trim(),
        prompt: values.prompt,
        timing: formToTiming(values),
      })
      router.push(`/scheduled/${encodeURIComponent(created.id)}`)
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      setError(
        err instanceof ApiError || err instanceof ScheduleFormError ? err.message : 'Could not create the task.',
      )
      setSaving(false)
    }
  }

  return (
    <Center axis="horizontal" paddingBlock={6}>
      <VStack gap={4} width="100%" maxWidth={640}>
        <Heading level={1} type="display-2">
          New scheduled task
        </Heading>
        {error !== null && <Banner status="error" title={error} isDismissable onDismiss={() => setError(null)} />}
        <ScheduleFields
          values={values}
          errors={errors}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />
        <HStack gap={2} justify="end">
          <Button label="Cancel" onClick={() => router.push('/scheduled')} />
          <Button label="Create" variant="primary" isDisabled={saving} onClick={() => void create()} />
        </HStack>
      </VStack>
    </Center>
  )
}
