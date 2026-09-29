import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/main.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
})
