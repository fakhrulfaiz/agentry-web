'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/** Moves focus to the first control inside the returned ref's element when it mounts. */
export function useFocusFirstControl<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [])
  return ref
}

/** Focuses the first control (or editor) inside `root`. */
export function focusFirstControl(root: HTMLElement | null): void {
  root?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
}

/** Focuses the text editor inside `root` (a composer), else its first control. */
export function focusEditor(root: HTMLElement | null): void {
  const editor = root?.querySelector<HTMLElement>('[contenteditable="true"], textarea:not([disabled])')
  if (editor) editor.focus()
  else focusFirstControl(root)
}
