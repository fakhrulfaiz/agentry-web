'use client'

/**
 * Assistant prose. Rendered by astryx `Markdown` (GFM tables, fenced code in a
 * copyable `CodeBlock`, safe links; raw HTML in the model's text is shown as
 * text, never parsed). `$…$` / `$$…$$` math is typeset with KaTeX. Images are
 * never loaded: `![alt](url)` becomes a link labelled with its alt text, so a
 * prompt-injected image URL cannot send conversation data anywhere without a
 * click.
 */
import { ArrowUpRightIcon } from '@heroicons/react/16/solid'
import { Button } from '@astryxdesign/core/Button'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Link } from '@astryxdesign/core/Link'
import { Markdown as AstryxMarkdown, type MarkdownComponents } from '@astryxdesign/core/Markdown'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Children, isValidElement, type ReactNode, useMemo } from 'react'

function MathView({ value, display }: { value: string; display: 'inline' | 'block' }) {
  const html = useMemo(
    () => katex.renderToString(value, { displayMode: display === 'block', throwOnError: false, trust: false, output: 'htmlAndMathml' }),
    [value, display],
  )
  // KaTeX's own output for the TeX source (trust: false, so no links, classes or styles from the text);
  // the model's text never reaches the DOM as HTML.
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function CodeView({ code, language }: { code: string; language?: string }) {
  return <CodeBlock code={code} language={language || 'plaintext'} width="100%" hasCopyButton />
}

/** A remote image as a plain link (opens in a new tab only when clicked). */
function ImageView({ src, alt }: { src: string; alt: string }) {
  const label = alt.trim() || src
  return (
    <Link href={src} isExternalLink referrerPolicy="no-referrer" tooltip={src}>
      {`Image: ${label}`}
    </Link>
  )
}

/** True for a Composio Connect Link: https, host exactly `connect.composio.dev`, path under `/link/`. */
export function isConnectLink(href: string): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.hostname === 'connect.composio.dev' && url.pathname.startsWith('/link/')
  } catch {
    // Not an absolute URL, so it cannot be a connect link.
    return false
  }
}

function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children)
  return Children.toArray(node).map(plainText).join('')
}

/** Connect links become one primary button; every other link keeps the astryx Link styling. */
function LinkView({ href, children }: { href: string; children: ReactNode }) {
  if (isConnectLink(href)) {
    const label = plainText(children).replace(/^[^\p{L}\p{N}]+/u, '').trim() || href
    return (
      <Button
        label={label}
        variant="primary"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        endContent={<ArrowUpRightIcon width={16} height={16} aria-hidden />}
      />
    )
  }
  return /^https?:\/\//.test(href) ? <Link href={href} isExternalLink>{children}</Link> : <Link href={href}>{children}</Link>
}

const COMPONENTS: MarkdownComponents = { math: MathView, code: CodeView, image: ImageView, link: LinkView }

export function Markdown({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  return (
    <AstryxMarkdown components={COMPONENTS} isStreaming={isStreaming} autolink="gfm" headingLevelStart={2} contentWidth="100%">
      {text}
    </AstryxMarkdown>
  )
}
