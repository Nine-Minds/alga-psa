import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'actions/index': 'src/actions/index.ts',
    'components/index': 'src/components/index.ts',
    'types/index': 'src/types/index.ts',
    'services/index': 'src/services/index.ts',
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
