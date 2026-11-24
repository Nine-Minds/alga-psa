import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/providerConfig.ts', 'src/providerSecrets.ts', 'src/reconcileOnWireMessageId.ts', 'src/backfillResendOnWireMessageIds.ts', 'src/branding/index.ts', 'src/derivedTemplates.ts', 'src/templateLookup.ts', 'src/backfillDerivedTemplates.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\//,
    /^@shared\//,
  ],
  noExternal: [
    /^@alga-psa\/shared(?:\/|$)/,
  ],
});
