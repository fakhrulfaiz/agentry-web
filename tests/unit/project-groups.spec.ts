import { describe, expect, it } from 'vitest'
import type { OAIAgentSession, OAIProject } from '@/api/types'
import { groupSessionsForSidebar, isUnfiledSession } from '@/ui/shell/project-groups'

// Local noon on 2026-11-27, matching group.ts's local-calendar-day boundaries.
const NOW = new Date(2026, 10, 27, 12)
const secondsAgo = (days: number) => Math.floor(new Date(2026, 10, 27 - days, 12).getTime() / 1000)

function project(id: string, pinned = false, status: OAIProject['status'] = 'active'): OAIProject {
  return {
    id,
    object: 'project',
    name: id,
    status,
    pinned,
    agent_id: null,
    environment: null,
    archived_at: status === 'archived' ? secondsAgo(1) : null,
    created_at: secondsAgo(30),
    updated_at: secondsAgo(1),
  }
}

function session(id: string, createdAt: number, projectId: string | null = null): OAIAgentSession {
  return {
    id,
    object: 'agent.session',
    created_at: createdAt,
    last_active_at: createdAt,
    status: 'idle',
    error: null,
    metadata: {},
    vault_ids: [],
    agent: {} as OAIAgentSession['agent'],
    environment: { type: 'local' },
    project_id: projectId,
    required_actions: [],
    usage: null,
  }
}

const ids = (sessions: OAIAgentSession[]) => sessions.map((s) => s.id)

describe('project sidebar grouping', () => {
  it('puts pinned projects before active projects', () => {
    const sections = groupSessionsForSidebar(
      [project('p_active_1'), project('p_pinned_1', true), project('p_active_2'), project('p_pinned_2', true)],
      [],
      NOW,
    )

    expect(sections.map((s) => (s.type === 'project' ? s.project.id : s.title))).toEqual([
      'p_pinned_1',
      'p_pinned_2',
      'p_active_1',
      'p_active_2',
    ])
  })

  it('keeps project sections in project list order and sessions newest first', () => {
    const sections = groupSessionsForSidebar(
      [project('p_1'), project('p_2'), project('p_empty')],
      [
        session('s_1_old', secondsAgo(3), 'p_1'),
        session('s_2_new', secondsAgo(1), 'p_2'),
        session('s_1_new', secondsAgo(1), 'p_1'),
        session('s_2_old', secondsAgo(3), 'p_2'),
      ],
      NOW,
    )

    expect(sections.map((s) => (s.type === 'project' ? s.project.id : s.title))).toEqual(['p_1', 'p_2', 'p_empty'])
    expect(sections.map((s) => (s.type === 'project' ? ids(s.sessions) : ids(s.sessions)))).toEqual([
      ['s_1_new', 's_1_old'],
      ['s_2_new', 's_2_old'],
      [],
    ])
  })

  it('places unfiled sessions in date buckets', () => {
    const sections = groupSessionsForSidebar(
      [],
      [
        session('s_older', secondsAgo(45)),
        session('s_month', secondsAgo(15)),
        session('s_week', secondsAgo(3)),
        session('s_yesterday', secondsAgo(1)),
        session('s_today', secondsAgo(0)),
      ],
      NOW,
    )

    expect(sections.map((s) => (s.type === 'date' ? s.title : s.project.id))).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 days',
      'Previous 30 days',
      'Older',
    ])
    expect(sections.map((s) => ids(s.sessions))).toEqual([
      ['s_today'],
      ['s_yesterday'],
      ['s_week'],
      ['s_month'],
      ['s_older'],
    ])
  })

  it('does not place a project session in recent date buckets', () => {
    const sections = groupSessionsForSidebar(
      [project('p_1')],
      [session('s_project', secondsAgo(0), 'p_1'), session('s_unfiled', secondsAgo(0))],
      NOW,
    )

    expect(sections.map((s) => (s.type === 'project' ? s.project.id : s.title))).toEqual(['p_1', 'Today'])
    expect(sections.map((s) => ids(s.sessions))).toEqual([['s_project'], ['s_unfiled']])
  })

  it('treats a null project_id as unfiled', () => {
    expect(isUnfiledSession(session('s_unfiled', secondsAgo(0), null))).toBe(true)
    expect(isUnfiledSession(session('s_filed', secondsAgo(0), 'p_1'))).toBe(false)
  })
})
