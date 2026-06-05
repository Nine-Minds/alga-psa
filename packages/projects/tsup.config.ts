import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// nx-modularity (2026-06-05): emit per-file dist (preset, bundle:false) so the app
// can consume @alga-psa/projects from dist (deep sub-paths) instead of turbopack
// recompiling projects/src. Preserves 'use server'/'use client' directives.
export default defineConfig(makeConfig({
  jsxEnabled: true,
  external: ['react', 'react-dom', 'next', 'next/navigation', 'next/link', 'next-auth', 'next-auth/react'],
}));
