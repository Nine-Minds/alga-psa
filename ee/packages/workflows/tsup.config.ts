import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'actions/index': 'src/actions/index.ts',
    'components/index': 'src/components/index.ts',
    'runtime/index': 'src/runtime/index.ts',
    'workers/index': 'src/workers/index.ts',
    'persistence/index': 'src/persistence/index.ts',
    'bundle/index': 'src/bundle/index.ts',
    'streams/index': 'src/streams/index.ts',
    'expression-authoring/index': 'src/expression-authoring/index.ts',
    'secrets/index': 'src/secrets/index.ts',
    'services/index': 'src/services/index.ts',
    'types/index': 'src/types/index.ts',
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
    /^@shared\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
