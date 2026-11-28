import path from 'node:path'
import withStylex from '@stylexswc/nextjs-plugin/turbopack'
import type { NextConfig } from 'next'

const root = import.meta.dirname

const isDev = process.env.NODE_ENV === 'development'

/**
 * Baseline Content Security Policy (no nonces). Next's inline bootstrap scripts
 * need 'unsafe-inline' (and dev/HMR 'unsafe-eval'); KaTeX and astryx set inline
 * styles. Fonts: theme-neutral imports Figtree from Google Fonts. Images only
 * from this origin, data: URLs and the connector logo host (assistant Markdown never loads remote images).
 * `form-action` is left unset: the Keycloak sign-in form redirects to the
 * realm's origin, which is only known at runtime.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://logos.composio.dev",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Artifact bytes are untrusted agent output. They may be framed by this origin
 * (the preview dialog's PDF), and run no script even when served as HTML.
 */
const artifactCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'"
const ARTIFACT_CONTENT = '/api/agentry/agents/artifacts/:id/content'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `/preview/<token>/` must keep its trailing slash: relative URLs in the previewed app resolve against it.
  skipTrailingSlashRedirect: true,
  // The e2e run builds into its own directory, so it can run beside a `next dev` on `.next`.
  distDir: process.env.AGENTRY_WEB_DIST_DIR || '.next',
  // The Docker image (Dockerfile) runs Next's self-contained server; `next start` does not need it.
  ...(process.env.AGENTRY_WEB_STANDALONE ? { output: 'standalone' as const } : {}),
  experimental: {
    // Every signed-in page is dynamic (the session cookie), and Next keeps no
    // client copy of a dynamic page by default, so each sidebar click waited on
    // the server. The pages are thin shells that load their data in the
    // browser, so a copy reused for a minute is safe and makes going back instant.
    staleTimes: { dynamic: 60 },
  },
  async headers() {
    return [
      {
        source: ARTIFACT_CONTENT,
        headers: [
          { key: 'Content-Security-Policy', value: artifactCsp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/:path((?!api/agentry/agents/artifacts/[^/]+/content$|preview/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

// StyleX via the SWC (Rust) compiler, so next/font keeps working. Turbopack compiles
// StyleX in JS here; CSS extraction is done by @stylexswc/postcss-plugin (postcss.config.mjs).
// Astryx components ship prebuilt CSS and are never compiled.
export default withStylex({
  rsOptions: {
    dev: process.env.NODE_ENV === 'development',
    aliases: { '@/*': [path.join(root, 'src/*')] },
    unstable_moduleResolution: { type: 'commonJS' },
    // Our atomic classes get their own prefix so they never share a name with astryx's prebuilt
    // (layered) classes: an unlayered copy of e.g. `background-color: transparent` used to beat
    // astryx's layered :hover rule and removed hover backgrounds app-wide. Must match postcss.config.mjs.
    classNamePrefix: 'a',
  },
})(nextConfig)
