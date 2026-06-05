import { defineConfig } from 'tsup';

// nx-modularity spike (2026-06-04): emit a per-file dist mirroring src so the app
// can consume @alga-psa/billing from dist (deep sub-path imports) instead of
// turbopack recompiling all of billing/src. bundle:false keeps each file separate;
// esbuild preserves 'use server'/'use client' directives per file.
export default defineConfig({
  entry: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/*.stories.tsx',
    '!src/**/*.d.ts',
  ],
  format: ['esm'],
  dts: false,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    'react',
    'react-dom',
    'next',
    'next/navigation',
    'next/link',
    'next-auth',
    'next-auth/react',
    /^@alga-psa\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
