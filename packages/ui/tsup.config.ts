import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Only buildable code - no 'use client' directives, no React runtime dependencies
    'index': 'src/index.ts',
    // lib utilities (buildable)
    'lib/utils': 'src/lib/utils.ts',
    'lib/colorUtils': 'src/lib/colorUtils.ts',
    'lib/i18n/config': 'src/lib/i18n/config.ts',
    'lib/i18n/interpolateFallback': 'src/lib/i18n/interpolateFallback.ts',
    // ui-reflection types and builders (buildable - no React)
    'ui-reflection/types': 'src/ui-reflection/types.ts',
    'ui-reflection/actionBuilders': 'src/ui-reflection/actionBuilders.ts',
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
    'next/headers',
    'next-auth',
    'next-auth/react',
    /^@alga-psa\/.*/,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
