/**
 * Starter setups for the New template editor's "Start from" row. Each one fills the form (name and the
 * software or limits it sets up); nothing is saved until the person presses Create. They sit on top of the
 * standard image (Debian, Python 3.11, Node 24, pnpm, git, pandas and the Office libraries), so they only
 * list what that image lacks. Provider fields a place does not support are dropped when the form is saved.
 */
import type { TemplateForm } from './format'

export interface TemplateStarter {
  id: string
  name: string
  summary: string
  set: Partial<Pick<TemplateForm, 'image' | 'system' | 'python' | 'npm' | 'setup' | 'network'>>
}

export const TEMPLATE_STARTERS: TemplateStarter[] = [
  {
    id: 'data-science',
    name: 'Data science',
    summary: 'Charts, statistics and machine learning on top of pandas.',
    set: { python: 'matplotlib\nseaborn\nscipy\nscikit-learn' },
  },
  {
    id: 'web-scraping',
    name: 'Web and scraping',
    summary: 'Fetch and parse web pages with Python.',
    set: { python: 'requests\nbeautifulsoup4\nhttpx' },
  },
  {
    id: 'node-typescript',
    name: 'Node and TypeScript',
    summary: 'TypeScript and a runner for it, with the standard Node.',
    set: { npm: 'typescript\ntsx' },
  },
  {
    id: 'coding-agents',
    name: 'Coding agents',
    summary: 'The Claude Code and Codex command-line agents. They need their own API keys to work.',
    set: { npm: '@anthropic-ai/claude-code\n@openai/codex', system: 'ripgrep' },
  },
  {
    id: 'python-313',
    name: 'Python 3.13',
    summary: 'The python:3.13 image instead of the standard one. Node and pandas are not included.',
    set: { image: 'python:3.13' },
  },
  {
    id: 'offline',
    name: 'Offline',
    summary: 'No internet at all, for running code you do not trust.',
    set: { network: false },
  },
]
