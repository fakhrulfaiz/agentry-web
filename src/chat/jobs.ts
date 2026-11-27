/** The chat's background jobs as the panel's Tasks tab and job tabs show them. */
import type { OAIJob } from '@/api/types'

/**
 * A running job younger than this is not listed yet. The API registers every
 * shell command as a job, foreground ones included, and drops a foreground
 * command when it finishes in time; hiding the first seconds keeps quick
 * commands from flashing through the list.
 */
export const JOB_GRACE_SECONDS = 3
/** How often an open job tab re-reads a running job's output. */
export const JOB_POLL_MS = 2_000

/** View key of one job's panel tab. */
export const jobViewKey = (id: string) => `job:${id}`
/** The job id of a `job:<id>` view key, else null. */
export const parseJobViewKey = (key: string): string | null => (key.startsWith('job:') ? key.slice(4) : null)

export const isLiveJob = (job: Pick<OAIJob, 'status'>): boolean => job.status === 'running' || job.status === 'stopping'

/** Jobs worth a row: every settled one, and running ones past the grace period. */
export function visibleJobs(jobs: readonly OAIJob[], nowSeconds: number): OAIJob[] {
  return jobs.filter((job) => !isLiveJob(job) || nowSeconds - job.started_at >= JOB_GRACE_SECONDS)
}

/** The command's first line, for a row or tab title. */
export function jobTitle(job: Pick<OAIJob, 'command' | 'kind' | 'id'>): string {
  const line = job.command.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return job.kind === 'bash' ? 'Command' : job.kind
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

export type JobTone = 'running' | 'done' | 'failed' | 'stopped'

/** Status word and tone. A nonzero exit is reported as completed by the API; it shows as failed here. */
export function jobState(job: Pick<OAIJob, 'status' | 'exit_code'>): { label: string; tone: JobTone } {
  switch (job.status) {
    case 'running':
      return { label: 'Running', tone: 'running' }
    case 'stopping':
      return { label: 'Stopping', tone: 'running' }
    case 'killed':
      return { label: 'Stopped', tone: 'stopped' }
    case 'failed':
      return { label: 'Failed', tone: 'failed' }
    case 'completed':
      return job.exit_code !== null && job.exit_code !== 0 ? { label: `Exit ${String(job.exit_code)}`, tone: 'failed' } : { label: 'Done', tone: 'done' }
  }
}

/** Seconds the job has run: until now while live, else until it finished. */
export function jobElapsed(job: Pick<OAIJob, 'status' | 'started_at' | 'finished_at'>, nowSeconds: number): number {
  const end = isLiveJob(job) ? nowSeconds : (job.finished_at ?? nowSeconds)
  return Math.max(0, end - job.started_at)
}
