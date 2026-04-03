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
  format: ['esm'],
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

