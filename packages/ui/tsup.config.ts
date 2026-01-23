import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'ui-reflection/index': 'src/ui-reflection/index.ts',
    'lib/index': 'src/lib/index.ts',
    'hooks/index': 'src/hooks/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
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
