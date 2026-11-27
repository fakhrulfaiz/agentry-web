'use client'

/**
 * One background job's panel tab (`job:<id>`): its command, status, elapsed
 * time and output (monospace, following the end while the reader is there),
 * re-read every `JOB_POLL_MS` while it runs, with a Stop button that asks first.
 * The status itself also follows the chat's `job.*` events.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { colorVars, radiusVars, spacingVars, typographyVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { OAIJob } from '@/api/types'
import { usePanelConversation } from '@/chat/panel-data'
import { JOB_POLL_MS, isLiveJob, jobElapsed, jobState, jobTitle } from '@/chat/jobs'
import { formatDuration } from '@/ui/chat/SubagentCard'
import { JOB_COLOR, useNow } from './PanelTabs'

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'], minHeight: 0, flexGrow: 1 },
  command: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
  },
  output: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
    padding: spacingVars['--spacing-3'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
    overflowY: 'auto',
    minHeight: 120,
    flexGrow: 1,
    flexBasis: 0,
  },
})

/** Lifecycle order: running, stopping, then settled. */
const stage = (job: Pick<OAIJob, 'status'>) => (job.status === 'running' ? 0 : job.status === 'stopping' ? 1 : 2)

/** Within this many pixels of the bottom counts as "at the end": new output scrolls into view. */
const FOLLOW_SLACK_PX = 24

export function JobTab({ sessionId, jobId }: { sessionId: string; jobId: string }) {
  const { jobs } = usePanelConversation()
  const fromStream = jobs.find((j) => j.id === jobId)
  const [read, setRead] = useState<OAIJob | null>(null)
  const [gone, setGone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Status from whichever copy is further along (the stream between polls, the Stop answer before its event); output from the read.
  const newer = !read ? fromStream : !fromStream || stage(read) > stage(fromStream) ? read : fromStream
  const job: OAIJob | undefined = newer && read ? { ...newer, output: read.output } : newer
  const live = job ? isLiveJob(job) : false
  const now = useNow(live)

  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const next = await api.job(sessionId, jobId, abort.signal)
        if (abort.signal.aborted) return
        setRead(next)
        setError(null)
        if (isLiveJob(next)) timer = setTimeout(() => void load(), JOB_POLL_MS)
      } catch (e) {
        if (abort.signal.aborted) return
        if (e instanceof ApiError && e.status === 404) setGone(true)
        else {
          setError(e instanceof Error ? e.message : 'The output could not be read.')
          timer = setTimeout(() => void load(), JOB_POLL_MS * 2)
        }
      }
    }
    void load()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
    // A settle event from the stream re-reads once, for the final output.
  }, [sessionId, jobId, fromStream?.status])

  const outRef = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const text = job?.output?.text ?? ''
  useLayoutEffect(() => {
    const el = outRef.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [text])
  const onScroll = () => {
    const el = outRef.current
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX
  }

  const stop = async () => {
    setStopping(true)
    try {
      const answer = await api.killJob(sessionId, jobId)
      setRead((r) => (r ? { ...answer.job, output: r.output } : answer.job))
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The job could not be stopped.')
      setConfirming(false)
    } finally {
      setStopping(false)
    }
  }

  if (!job) {
    if (gone) return <EmptyState title="Job not found" description="It finished and left the list, or the server restarted." headingLevel={2} />
    return <Skeleton height={120} />
  }
  const state = jobState(job)
  const meta = [job.kind, formatDuration(jobElapsed(job, now)), job.detail].filter(Boolean).join(' · ')
  return (
    <div {...stylex.props(styles.page)} data-testid="job-tab">
      <HStack gap={2} vAlign="start">
        <StackItem size="fill">
          <VStack gap={1}>
            <pre {...stylex.props(styles.command)}>{job.command || jobTitle(job)}</pre>
            <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>{meta}</Text>
          </VStack>
        </StackItem>
        <Token size="sm" label={state.label} color={JOB_COLOR[state.tone]} />
        {job.status === 'running' && <Button label="Stop" size="sm" variant="secondary" onClick={() => setConfirming(true)} />}
      </HStack>
      {error && <Banner status="error" title={error} />}
      {job.output?.truncated && <Text type="supporting" color="secondary">Showing the newest output only.</Text>}
      <pre ref={outRef} onScroll={onScroll} aria-label="Output" tabIndex={0} {...stylex.props(styles.output)}>
        {text || (live ? 'No output yet.' : 'No output.')}
      </pre>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={(open: boolean) => !open && setConfirming(false)}
        title="Stop this command?"
        description="The process is ended and the agent is told it was stopped."
        actionLabel="Stop"
        isActionLoading={stopping}
        onAction={() => void stop()}
      />
    </div>
  )
}
