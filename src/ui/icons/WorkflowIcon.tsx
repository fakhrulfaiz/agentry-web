import type { SVGProps } from 'react'

// Copy of lucide's `workflow` icon (ISC license, https://lucide.dev).
/** Two small blocks joined to a larger one: the icon for a chat's helpers (subagents). */
export function WorkflowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </svg>
  )
}
