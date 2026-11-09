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
