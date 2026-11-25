import { defineConfig } from 'tsup';
import { SOURCE_ONLY_ALGA_IMPORTS } from '../../../shared/tsup.sourceOnlyImports';

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
    // Reply parsing reaches Mailparser through forwarded-message detection.
    // Let Node load its CommonJS dependencies instead of bundling their require
    // calls into the native ESM runtime used by the authored-workflow probe.
    'mailparser',
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
  // The runtime bundles shared/workflow source by relative path, so it must
  // inline the same source-only imports shared/dist does.
  noExternal: SOURCE_ONLY_ALGA_IMPORTS,
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
