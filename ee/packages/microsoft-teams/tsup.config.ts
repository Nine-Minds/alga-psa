import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'actions/index': 'src/actions/index.ts',
    'components/index': 'src/components/index.ts',
    'routes/index': 'src/routes/index.ts',
    'lib/index': 'src/lib/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    'react',
    'react-dom',
    'next',
    'next/server',
    'next/navigation',
    'next/link',
    /^@alga-psa\//,
    /^@shared\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
