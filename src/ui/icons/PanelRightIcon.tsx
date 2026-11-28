import type { SVGProps } from 'react'

/** A window with its right pane marked: the icon for the chat's right-hand panel (the mirror of the sidebar's). */
export function PanelRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" d="M15 4v16" />
    </svg>
  )
}
