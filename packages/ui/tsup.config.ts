import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'components/bento/index': 'src/components/bento/index.ts',
    'ui-reflection/index': 'src/ui-reflection/index.ts',
    'keyboard-shortcuts/index': 'src/keyboard-shortcuts/index.ts',
    'lib/index': 'src/lib/index.ts',
    'hooks/index': 'src/hooks/index.ts',
  },
  format: ['esm'],
  dts: false,
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
    // `/fonts/*` in TicketDetails.module.css are runtime URLs served by Next from
    // server/public; esbuild would otherwise try to resolve them off disk and fail.
    options.external = [...(options.external ?? []), '/fonts/*'];
  },
});
