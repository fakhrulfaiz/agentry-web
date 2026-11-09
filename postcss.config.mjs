// Extracts StyleX CSS into the `@stylex;` directive in app/globals.css.
// Only our own source is scanned; astryx ships prebuilt CSS.
const config = {
  plugins: {
    '@stylexswc/postcss-plugin': {
      include: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      rsOptions: {
        dev: process.env.NODE_ENV === 'development',
        aliases: { '@/*': [`${import.meta.dirname}/src/*`] },
        unstable_moduleResolution: { type: 'commonJS' },
      },
    },
  },
}

export default config
