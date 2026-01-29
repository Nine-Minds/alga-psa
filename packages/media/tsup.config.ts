import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  external: [
    // Externalize all @alga-psa packages
    /^@alga-psa\/.*/,
    // Externalize all node_modules
    /^[^./]/,
  ],
  // Don't bundle dependencies
  noExternal: [],
});
