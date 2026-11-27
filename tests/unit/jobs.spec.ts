import { describe, expect, it } from 'vitest'
import type { OAIJob } from '@/api/types'
import { JOB_GRACE_SECONDS, jobElapsed, jobState, jobTitle, jobViewKey, parseJobViewKey, visibleJobs } from '@/chat/jobs'
import { applyEvent, applyJobs, initialState } from '@/chat/reducer'

const job = (over: Partial<OAIJob> = {}): OAIJob => ({
  id: 'bash-1', object: 'agent.session.job', session_id: 's1', kind: 'bash', command: 'npm run build', status: 'running',
  detail: null, exit_code: null, started_at: 1000, finished_at: null, ...over,
})

describe('job helpers', () => {
  it('hides running jobs during the grace period only', () => {
    const young = job({ id: 'a', started_at: 1000 })
    const settled = job({ id: 'b', started_at: 1000, status: 'completed', finished_at: 1000, exit_code: 0 })
    expect(visibleJobs([young, settled], 1000 + JOB_GRACE_SECONDS - 1).map((j) => j.id)).toEqual(['b'])
    expect(visibleJobs([young, settled], 1000 + JOB_GRACE_SECONDS).map((j) => j.id)).toEqual(['a', 'b'])
  })

  it('names states, treating a nonzero exit as failed', () => {
    expect(jobState(job())).toEqual({ label: 'Running', tone: 'running' })
    expect(jobState(job({ status: 'stopping' })).label).toBe('Stopping')
    expect(jobState(job({ status: 'completed', exit_code: 0 }))).toEqual({ label: 'Done', tone: 'done' })
    expect(jobState(job({ status: 'completed', exit_code: 2 }))).toEqual({ label: 'Exit 2', tone: 'failed' })
    expect(jobState(job({ status: 'killed' }))).toEqual({ label: 'Stopped', tone: 'stopped' })
    expect(jobState(job({ status: 'failed' })).tone).toBe('failed')
  })

  it('titles by the first command line and times live and settled jobs', () => {
    expect(jobTitle(job({ command: '  cd app\nnpm test' }))).toBe('cd app')
    expect(jobTitle(job({ command: '' }))).toBe('Command')
    expect(jobTitle(job({ command: 'x'.repeat(100) }))).toHaveLength(80)
    expect(jobElapsed(job(), 1065)).toBe(65)
    expect(jobElapsed(job({ status: 'completed', finished_at: 1010 }), 2000)).toBe(10)
    expect(parseJobViewKey(jobViewKey('bash-1'))).toBe('bash-1')
    expect(parseJobViewKey('sub:x')).toBeNull()
  })
})

describe('job events in the reducer', () => {
  it('upserts from events keeping the last read output, and drops removed jobs', () => {
    const output = { text: 'hi\n', total_bytes: 3, truncated: false }
    let s = applyJobs(initialState('s1'), [job({ output })])
    s = applyEvent(s, { event: { type: 'agent.session.job.updated', event_id: 'e1', session_id: 's1', job: job({ status: 'completed', exit_code: 0, finished_at: 1004 }) } })
    expect(s.jobs).toEqual([job({ status: 'completed', exit_code: 0, finished_at: 1004, output })])
    s = applyEvent(s, { event: { type: 'agent.session.job.updated', event_id: 'e2', session_id: 's1', job: job({ id: 'bash-2' }) } })
    expect(s.jobs.map((j) => j.id)).toEqual(['bash-1', 'bash-2'])
    s = applyEvent(s, { event: { type: 'agent.session.job.removed', event_id: 'e3', session_id: 's1', job_id: 'bash-2' } })
    expect(s.jobs.map((j) => j.id)).toEqual(['bash-1'])
  })
})
