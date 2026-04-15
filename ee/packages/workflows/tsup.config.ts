import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/secrets.ts',
    'src/lib/**/*.ts',
    'src/persistence/**/*.ts',
    'src/runtime/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/__tests__/**',
  ],
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
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
