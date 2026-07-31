import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/providerConfig.ts'],
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
});
