import { defineConfig } from 'tsup';

// Unlike the other emulator packages, this one bundles: the QBO domain core
// lives in @alga-psa/billing as TypeScript source (billing owns those
// semantics and its own tests inject the simulator directly), so the shells
// here inline it at build time instead of requiring billing's dist at runtime.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  bundle: true,
  splitting: false,
  dts: false,
  sourcemap: false,
  clean: true,
  external: ['@alga-psa/emulator-host', 'express', 'zod'],
  noExternal: [/^@alga-psa\/billing/],
});
