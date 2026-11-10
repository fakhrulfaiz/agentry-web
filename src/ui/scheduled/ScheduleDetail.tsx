'use client'

/**
 * A scheduled task's detail page, mixing the claude.ai task page with the
 * automation-panel idea: the read view (title and actions above a two-column
 * body — delivery history whose rows open each run's chat, and the task's
 * instructions, repeats and linked session) beside an Edit drawer shaped like
 * the automation panel's rule editor (name, instruction, run time, linked
 * session; Discard and Save changes in the footer). Save posts title, prompt,
 * timing and the record's revision; Discard throws the draft away and closes.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Center } from '@astryxdesign/core/Center'
import { Divider } from '@astryxdesign/core/Divider'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Switch } from '@astryxdesign/core/Switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table'
import { TextArea } from '@astryxdesign/core/TextArea'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TimeInput } from '@astryxdesign/core/TimeInput'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline'
import { ChevronRightIcon } from '@heroicons/react/24/solid'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { ISODateString, ISOTimeString } from '@astryxdesign/core/utils'
import type { AgentSchedule, AgentScheduleRun } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { describeTiming } from '@/schedule/describe'
import {
  EMPTY_FORM,
  FREQUENCIES,
  browserTimeZone,
  formToTiming,
  timingToForm,
  type Frequency,
  type ScheduleFormValues,
  ScheduleFormError,
} from '@/schedule/form'
import { DeleteScheduleDialog } from '@/ui/scheduled/ScheduleDialogs'

const PAGE_LIMIT = 20
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

/** The draft's fields that matter for dirtiness; weekdays compared as a sorted list. */
const dirtyKeys: (keyof ScheduleFormValues)[] = ['title', 'prompt', 'frequency', 'date', 'time', 'interval', 'cron', 'timeZone']

function isDraftChanged(a: ScheduleFormValues, b: ScheduleFormValues): boolean {
  for (const key of dirtyKeys) if (a[key] !== b[key]) return true
  return [...a.weekdays].sort().join(',') !== [...b.weekdays].sort().join(',')
}

export function ScheduleDetail({ id, initialEdit = false }: { id: string; initialEdit?: boolean }) {
  const router = useRouter()
  const [schedule, setSchedule] = useState<AgentSchedule | null>(null)
  const [runs, setRuns] = useState<AgentScheduleRun[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draft, setDraft] = useState<ScheduleFormValues | null>(null)
  const [saved, setSaved] = useState<ScheduleFormValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** The `/edit` route auto-opens the drawer once, when the task has loaded. */
  const autoOpened = useRef(false)

  /** Loads the task first, then the first page of its history. */
  const load = useCallback(async () => {
    setSchedule(null)
    setRuns(null)
    setError(null)
    setNotFound(false)
    let task: AgentSchedule
    try {
      task = await api.getSchedule(id)
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not load the task.')
      return
    }
    setSchedule(task)
    try {
      const page = await api.listScheduleRuns(id, { limit: PAGE_LIMIT })
      setRuns(page.data)
      setNextBefore(page.next_before)
      setHasMore(page.has_more)
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not load the task.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const explain = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError && isSignedOut(err)) {
      goToLogin()
      return
    }
    setActionError(err instanceof ApiError ? err.message : fallback)
  }, [])

  /** Re-reads the task and the newest history page, keeping the scroll. */
  const refresh = useCallback(async () => {
    try {
      const [task, page] = await Promise.all([
        api.getSchedule(id),
        api.listScheduleRuns(id, { limit: PAGE_LIMIT }),
      ])
      setSchedule(task)
      setRuns(page.data)
      setNextBefore(page.next_before)
      setHasMore(page.has_more)
      setError(null)
    } catch (err) {
      explain(err, 'Could not refresh the task.')
    }
  }, [id, explain])

  const pauseResume = async (loaded: AgentSchedule) => {
    setActionError(null)
    setPending(true)
    setSchedule(loaded.status === 'active' ? { ...loaded, status: 'paused' } : { ...loaded, status: 'active' })
    try {
      setSchedule(
        loaded.status === 'active' ? await api.pauseSchedule(loaded.id) : await api.resumeSchedule(loaded.id),
      )
    } catch (err) {
      setSchedule(loaded)
      explain(err, 'Could not update the task.')
    } finally {
      setPending(false)
    }
  }

  const runNow = async (loaded: AgentSchedule) => {
    setActionError(null)
    setPending(true)
    try {
      setSchedule(await api.runSchedule(loaded.id))
      await refresh()
    } catch (err) {
      explain(err, 'Could not start the task.')
    } finally {
      setPending(false)
    }
  }

  const loadMore = async () => {
    if (nextBefore === null) return
    setLoadingMore(true)
    try {
      const page = await api.listScheduleRuns(id, { limit: PAGE_LIMIT, before: nextBefore })
      setRuns((rows) => [...(rows ?? []), ...page.data])
      setNextBefore(page.next_before)
      setHasMore(page.has_more)
    } catch (err) {
      explain(err, 'Could not load older runs.')
    } finally {
      setLoadingMore(false)
    }
  }

  const patch = (values: Partial<ScheduleFormValues>) =>
    setDraft((current) => (current ? { ...current, ...values } : current))

  /** Fills the editor drawer from the saved task. The saved copy drives the dirty check. */
  const openEdit = (loaded: AgentSchedule) => {
    setDraft({
      ...timingToForm(loaded.timing, { ...EMPTY_FORM, timeZone: browserTimeZone() }),
      title: loaded.title,
      prompt: loaded.prompt,
    })
    setSaved({
      ...timingToForm(loaded.timing, { ...EMPTY_FORM, timeZone: browserTimeZone() }),
      title: loaded.title,
      prompt: loaded.prompt,
    })
    setSaveError(null)
    setDrawerOpen(true)
  }

  const closeEdit = useCallback(() => {
    setDrawerOpen(false)
    setDraft(null)
    setSaved(null)
    setSaveError(null)
  }, [])

  useEffect(() => {
    // Only the /edit route asks for the editor without a click; never reopen it after a close.
    if (initialEdit && !autoOpened.current && schedule !== null) {
      autoOpened.current = true
      openEdit(schedule)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEdit, schedule])

  const isDirty = draft !== null && saved !== null && isDraftChanged(draft, saved)

  const save = async (loaded: AgentSchedule) => {
    if (draft === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await api.updateSchedule(loaded.id, {
        title: draft.title,
        prompt: draft.prompt,
        timing: formToTiming(draft),
        revision: loaded.revision,
      })
      setSchedule(updated)
      closeEdit()
      void refresh()
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      setSaveError(
        err instanceof ApiError || err instanceof ScheduleFormError
          ? err.message
          : 'Could not save the task.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (notFound) {
    return (
      <Center axis="horizontal" paddingBlock={6}>
        <VStack gap={3}>
          <Heading level={1} type="display-2">
            Task not found
          </Heading>
          <Text color="secondary">This scheduled task no longer exists.</Text>
          <Link href="/scheduled">Back to scheduled tasks</Link>
        </VStack>
      </Center>
    )
  }

  const task = schedule
  const zoneLabel = (zone: string) => (zone === browserTimeZone() ? `${zone} (system)` : zone)
  const frequencyLabel = FREQUENCIES.find((f) => f.value === draft?.frequency)?.label ?? ''

  const drawer = task !== null && draft !== null && (
    <Drawer
      isOpen={drawerOpen}
      onOpenChange={(open) => (open ? setDrawerOpen(true) : closeEdit())}
      label="Edit rule"
      width={420}
      purpose="form"
    >
      <Layout
        header={
          <DrawerHeader
            title={task.title}
            subtitle={
              task.next_run_at ? (
                <>
                  Next run: <Timestamp value={task.next_run_at} format="date_time" />
                </>
              ) : (
                'Next run: not scheduled'
              )
            }
            onOpenChange={(open) => (open ? setDrawerOpen(true) : closeEdit())}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={4}>
              {saveError !== null && (
                <Banner status="error" title={saveError} isDismissable onDismiss={() => setSaveError(null)} />
              )}
              <VStack gap={3}>
                <TextInput label="Task name" value={draft.title} onChange={(title) => patch({ title })} />
                <TextArea
                  label="Task instruction"
                  value={draft.prompt}
                  onChange={(prompt) => patch({ prompt })}
                />
              </VStack>
              <Card padding={0}>
                <HStack gap={3} vAlign="center" justify="between" padding={3}>
                  <Text weight="medium">Run in</Text>
                  <DropdownMenu
                    button={{ label: 'Current linked session', size: 'sm', isDisabled: true }}
                    items={[{ label: 'Current linked session', isDisabled: true }]}
                  />
                </HStack>
              </Card>
              <Card padding={0}>
                <VStack gap={0}>
                  <HStack gap={3} vAlign="center" justify="between" padding={3}>
                    <Text weight="medium">Repeat</Text>
                    <DropdownMenu
                      button={{ label: frequencyLabel, size: 'sm' }}
                      items={FREQUENCIES.map((f) => ({
                        label: f.label,
                        isDisabled: f.value === draft.frequency,
                        onClick: () => patch({ frequency: f.value }),
                      }))}
                    />
                  </HStack>
                  {INTERVAL_FIELDS.includes(draft.frequency) && (
                    <>
                      <Divider />
                      <HStack gap={3} vAlign="center" justify="between" padding={3}>
                        <Text weight="medium">Interval</Text>
                        <NumberInput
                          label="Interval"
                          isLabelHidden
                          width="auto"
                          value={draft.interval}
                          min={1}
                          step={1}
                          onChange={(next) => patch({ interval: Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1 })}
                        />
                      </HStack>
                    </>
                  )}
                  {draft.frequency === 'weekly' && (
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
                              isPressed={draft.weekdays.includes(day.value)}
                              onPressedChange={() =>
                                patch({
                                  weekdays:
                                    draft.weekdays.includes(day.value) && draft.weekdays.length > 1
                                      ? draft.weekdays.filter((one) => one !== day.value)
                                      : [...draft.weekdays, day.value].sort((a, b) => a - b),
                                })
                              }
                            />
                          ))}
                        </HStack>
                      </HStack>
                    </>
                  )}
                  {draft.frequency === 'weekdays' && (
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
                  {draft.frequency === 'once' && (
                    <>
                      <Divider />
                      <HStack gap={3} vAlign="center" justify="between" padding={3}>
                        <Text weight="medium">Date</Text>
                        <DateInput
                          label="Date"
                          isLabelHidden
                          value={draft.date ? (draft.date as ISODateString) : undefined}
                          onChange={(date) => date && patch({ date })}
                        />
                      </HStack>
                    </>
                  )}
                  {TIMED_FIELDS.includes(draft.frequency) && (
                    <>
                      <Divider />
                      <HStack gap={3} vAlign="center" justify="between" padding={3}>
                        <Text weight="medium">Time</Text>
                        <TimeInput
                          label="Time"
                          isLabelHidden
                          width="auto"
                          value={draft.time as ISOTimeString}
                          onChange={(time) => time && patch({ time })}
                        />
                      </HStack>
                    </>
                  )}
                  {draft.frequency === 'custom' && (
                    <>
                      <Divider />
                      <HStack gap={3} vAlign="center" justify="between" padding={3}>
                        <Text weight="medium">Cron expression</Text>
                        <TextInput
                          label="Cron expression"
                          isLabelHidden
                          width="auto"
                          value={draft.cron}
                          onChange={(cron) => patch({ cron })}
                        />
                      </HStack>
                    </>
                  )}
                  {ZONE_FIELDS.includes(draft.frequency) && (
                    <>
                      <Divider />
                      <HStack gap={3} vAlign="center" justify="between" padding={3}>
                        <Text weight="medium">Time zone</Text>
                        <DropdownMenu
                          button={{ label: zoneLabel(draft.timeZone), size: 'sm' }}
                          alignment="end"
                          items={timeZoneChoices().map((zone) => ({
                            label: zoneLabel(zone),
                            isDisabled: zone === draft.timeZone,
                            onClick: () => patch({ timeZone: zone }),
                          }))}
                        />
                      </HStack>
                    </>
                  )}
                </VStack>
              </Card>
              <HStack gap={3} vAlign="center" justify="between">
                <Text weight="medium">Linked session</Text>
                <Button
                  label="Open chat"
                  size="sm"
                  endContent={<Icon icon={ChevronRightIcon} size="sm" />}
                  onClick={() => router.push(`/c/${encodeURIComponent(task.session_id)}`)}
                />
              </HStack>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} vAlign="center" justify="end">
              <Button label="Discard" onClick={closeEdit} />
              <Button
                label="Save changes"
                variant="primary"
                isDisabled={!isDirty || saving}
                onClick={() => void save(task)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Drawer>
  )

  const readBody = (
    <VStack gap={4}>
      {task !== null && task.status === 'ended' && (
        <Text color="secondary">This task has ended and cannot be resumed.</Text>
      )}
      {actionError !== null && (
        <Banner status="error" title={actionError} isDismissable onDismiss={() => setActionError(null)} />
      )}
      <HStack gap={6} vAlign="start">
        <StackItem size="fill">
          <VStack gap={2}>
            <Heading level={2}>History</Heading>
            {runs !== null && runs.length === 0 ? (
              <Card padding={4}>
                <Center axis="both">
                  <Text color="secondary">No runs yet</Text>
                </Center>
              </Card>
            ) : runs !== null ? (
              <VStack gap={2}>
                <Table density="compact" hasHover>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Scheduled</TableHeaderCell>
                      <TableHeaderCell>Delivered</TableHeaderCell>
                      <TableHeaderCell />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((entry) => (
                      <TableRow key={entry.message_id}>
                        <TableCell>
                          <Text type="supporting">
                            <Timestamp value={entry.scheduled_at} format="date_time" />
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text type="supporting">
                            <Timestamp value={entry.delivered_at} format="date_time" />
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Link href={`/c/${encodeURIComponent(entry.session_id)}`}>Open chat</Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {hasMore && (
                  <HStack hAlign="center" gap={2}>
                    <Button
                      label="Load more"
                      size="sm"
                      isDisabled={loadingMore}
                      onClick={() => void loadMore()}
                    />
                  </HStack>
                )}
              </VStack>
            ) : null}
          </VStack>
        </StackItem>
        {task !== null && (
          <VStack width={300} gap={4}>
            <VStack gap={1}>
              <Text weight="medium">Instructions</Text>
              <Text color="secondary">{task.prompt}</Text>
            </VStack>
            <Divider />
            <VStack gap={1}>
              <Text weight="medium">Repeats</Text>
              <Text color="secondary">
                {describeTiming(task.timing, undefined, browserTimeZone())}
              </Text>
            </VStack>
            <Divider />
            <VStack gap={1}>
              <Text weight="medium">Linked session</Text>
              <Link href={`/c/${encodeURIComponent(task.session_id)}`}>Open chat</Link>
            </VStack>
          </VStack>
        )}
      </HStack>
    </VStack>
  )

  return (
    <Center axis="horizontal" paddingBlock={6}>
      <VStack maxWidth={880} width="100%" gap={4} paddingInline={4}>
        {error !== null ? (
          <VStack>
            <Banner
              status="error"
              title={error}
              endContent={<Button label="Retry" size="sm" onClick={() => void load()} />}
            />
          </VStack>
        ) : null}
        {task === null && error === null ? (
          <VStack gap={2} data-testid="schedule-detail-loading">
            <Skeleton height={32} index={0} />
            <Skeleton height={32} index={1} />
          </VStack>
        ) : (
          <>
            <HStack gap={1} vAlign="center">
              <Link href="/scheduled">Scheduled tasks</Link>
              <Text color="secondary">/</Text>
            </HStack>
            <VStack gap={3}>
              <VStack gap={1}>
                <Heading level={1} type="display-2">
                  {task?.title ?? ''}
                </Heading>
                <HStack gap={1} vAlign="center">
                  <Text color="secondary">Next run:</Text>
                  {task?.next_run_at ? (
                    <Timestamp value={task.next_run_at} format="date_time" />
                  ) : (
                    <Text color="secondary">not scheduled</Text>
                  )}
                </HStack>
              </VStack>
              {task !== null && (
                <HStack gap={3} vAlign="center">
                  {task.status !== 'ended' && (
                    <Switch
                      label={`${task.status === 'active' ? 'Pause' : 'Resume'} ${task.title}`}
                      value={task.status === 'active'}
                      onChange={() => void pauseResume(task)}
                      isDisabled={pending}
                    />
                  )}
                  <StackItem size="fill">
                    <HStack gap={0} vAlign="stretch" justify="end">
                      <Button
                        label="Run now"
                        size="sm"
                        onClick={() => void runNow(task)}
                        isDisabled={pending}
                      />
                      <DropdownMenu
                        renderTrigger={(trigger) => (
                          <IconButton
                            {...trigger}
                            label={`More options for ${task.title}`}
                            icon={<Icon icon={EllipsisVerticalIcon} size="sm" />}
                            variant="ghost"
                            size="sm"
                          />
                        )}
                        alignment="end"
                        items={[
                          { label: 'Edit', onClick: () => openEdit(task) },
                          { type: 'divider' },
                          { label: 'Delete', variant: 'destructive', onClick: () => setDeleting(true) },
                        ]}
                      />
                    </HStack>
                  </StackItem>
                </HStack>
              )}
            </VStack>
            {readBody}
          </>
        )}
        {drawer}
        {task !== null && (
          <DeleteScheduleDialog
            schedule={deleting ? task : null}
            onClose={() => setDeleting(false)}
            onDeleted={() => router.push('/scheduled')}
          />
        )}
      </VStack>
    </Center>
  )
}
