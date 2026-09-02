import { defineConfig } from 'tsup';

// The 3CX emulator is loaded directly by Node.js in the algasim image. Its only
// @alga-psa dependency it must reach at runtime is the pre-built emulator-host;
// the pure ee-threecx route constants are bundled in so a route rename still
// moves the emulator, without shipping an unbuilt .ts import.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  target: 'node20',
  external: ['@alga-psa/emulator-host', 'express', 'zod'],
  // tsup auto-externalizes package.json dependencies; force the pure route
  // constants to bundle so the shipped dist has no unbuilt .ts import.
  noExternal: [/@alga-psa\/ee-threecx/],
});
