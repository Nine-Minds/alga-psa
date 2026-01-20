import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'actions/index': 'src/actions/index.ts',
    'components/index': 'src/components/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'lib/index': 'src/lib/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
});

