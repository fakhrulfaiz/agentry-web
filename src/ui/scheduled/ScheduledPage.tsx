'use client'

/**
 * The Scheduled page: Yours (a dense table of the user's tasks, or the empty
 * state with the starter templates) and Templates (all four cards). A task's
 * chat lives at `/scheduled/{id}`; the New task menu splits into the chat seed
 * and the manual form.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
import { ClockIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { AgentSchedule, ScheduleStatus } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { describeTiming } from '@/schedule/describe'
import { browserTimeZone, formToTiming } from '@/schedule/form'
import { TEMPLATES, templateValues, type ScheduleTemplate } from '@/schedule/templates'
import { SESSIONS_CHANGED } from '@/ui/shell/session-actions'
import { TopBar } from '@/ui/shell/TopBar'

type View = 'yours' | 'templates'

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
}

const scheduleLine = (template: ScheduleTemplate): string =>
  describeTiming(formToTiming(templateValues(template, browserTimeZone())))

function TemplateGrid({ onPick }: { onPick: (template: ScheduleTemplate) => void }) {
  const rows: ScheduleTemplate[][] = []
  for (let index = 0; index < TEMPLATES.length; index += 2) rows.push(TEMPLATES.slice(index, index + 2))
  return (
    <VStack gap={3}>
      {rows.map((row) => (
        <HStack key={row.map((template) => template.id).join('-')} gap={3} vAlign="stretch">
          {row.map((template) => (
            <StackItem key={template.id} size="fill">
              <ClickableCard label={template.title} onClick={() => onPick(template)} width="100%">
                <VStack gap={1}>
                  <Text weight="medium">{template.title}</Text>
                  <Text type="supporting" color="secondary">
                    {template.description}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {scheduleLine(template)}
                  </Text>
                </VStack>
              </ClickableCard>
            </StackItem>
          ))}
        </HStack>
      ))}
    </VStack>
  )
}

export function ScheduledPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('yours')
  const [schedules, setSchedules] = useState<AgentSchedule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await api.listSchedules()
      setSchedules(page.data)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not load scheduled tasks.')
    }
  }, [])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(SESSIONS_CHANGED, onChange)
    return () => window.removeEventListener(SESSIONS_CHANGED, onChange)
  }, [load])

  const newTask = (
    <DropdownMenu
      button={{ label: 'New task', variant: 'primary', size: 'sm' }}
      items={[
        { label: 'Create with chat', onClick: () => router.push('/?schedule=1') },
        { label: 'Set up manually', onClick: () => router.push('/scheduled/new') },
      ]}
      alignment="end"
    />
  )

  const pickTemplate = (template: ScheduleTemplate) => router.push(`/scheduled/new?template=${template.id}`)

  const content =
    schedules === null && error === null ? (
      <VStack padding={4} gap={3} data-testid="scheduled-loading">
        <Skeleton height={44} index={0} />
        <Skeleton height={44} index={1} />
        <Skeleton height={44} index={2} />
      </VStack>
    ) : schedules && schedules.length > 0 ? (
      <VStack padding={4} gap={3}>
        <Table density="compact" hasHover>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Schedule</TableHeaderCell>
              <TableHeaderCell>Next run</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <Link href={`/scheduled/${task.id}`}>{task.title}</Link>
                </TableCell>
                <TableCell>
                  <Text type="supporting">{describeTiming(task.timing, undefined, browserTimeZone())}</Text>
                </TableCell>
                <TableCell>
                  {task.next_run_at ? (
                    <Timestamp value={task.next_run_at} format="date_time" type="supporting" />
                  ) : (
                    <Text type="supporting">—</Text>
                  )}
                </TableCell>
                <TableCell>
                  <Text type="supporting">{STATUS_LABEL[task.status]}</Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </VStack>
    ) : (
      <Center axis="both" padding={8}>
        <VStack gap={4} width="100%" maxWidth={720} hAlign="center">
          <EmptyState
            icon={<Icon icon={ClockIcon} size="lg" color="secondary" />}
            title="No scheduled tasks yet."
            description="Set one up yourself, or start from a template below."
            actions={<Button label="Set up manually" onClick={() => router.push('/scheduled/new')} />}
          />
          <Divider label="Templates" />
          <TemplateGrid onPick={pickTemplate} />
        </VStack>
      </Center>
    )

  return (
    <VStack>
      <TopBar
        title="Scheduled tasks"
        end={newTask}
        tabs={
          <TabList value={view} onChange={(value) => setView(value as View)} size="sm" hasDivider>
            <Tab value="yours" label="Yours" />
            <Tab value="templates" label="Templates" />
          </TabList>
        }
      />
      {error !== null && (
        <VStack padding={4}>
          <Banner
            status="error"
            title={error}
            endContent={<Button label="Retry" size="sm" onClick={() => void load()} />}
          />
        </VStack>
      )}
      {view === 'templates' ? (
        <VStack padding={4}>
          <TemplateGrid onPick={pickTemplate} />
        </VStack>
      ) : (
        content
      )}
    </VStack>
  )
}
