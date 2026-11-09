import path from 'node:path'
import withStylex from '@stylexswc/nextjs-plugin/turbopack'
import type { NextConfig } from 'next'

const root = import.meta.dirname

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

// StyleX via the SWC (Rust) compiler, so next/font keeps working. Turbopack compiles
// StyleX in JS here; CSS extraction is done by @stylexswc/postcss-plugin (postcss.config.mjs).
// Astryx components ship prebuilt CSS and are never compiled.
export default withStylex({
  rsOptions: {
    dev: process.env.NODE_ENV === 'development',
    aliases: { '@/*': [path.join(root, 'src/*')] },
    unstable_moduleResolution: { type: 'commonJS' },
  },
})(nextConfig)
