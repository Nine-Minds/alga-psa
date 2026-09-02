import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'lib/index': 'src/lib/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    'next',
    'next/server',
    /^@alga-psa\//,
    /^@shared\//,
  ],
});
