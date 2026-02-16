import { defineConfig } from 'tsup';

// tsup v8+ requires explicit entry points (it no longer auto-detects src/index.ts).
// Keep output structure aligned with package.json "exports".
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/events.ts',
    'src/publishers/index.ts',
    'src/publishers/*.ts',
  ],
  format: ['esm', 'cjs'],
  // Prefer `.mjs` for ESM to match other workspace packages, and `.js` for CJS.
  // (This repo's packages commonly publish `.mjs` for import and `.js` for require.)
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.js' };
  },
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    'redis',
    'uuid',
    'zod',
  ],
});

