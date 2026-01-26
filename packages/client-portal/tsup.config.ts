import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - schemas without 'use server'/'use client' directives
    // Actions, components, models, and services are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'schemas/appointmentSchemas': 'src/schemas/appointmentSchemas.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\/.*/,
    'zod',
  ],
});
