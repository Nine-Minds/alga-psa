import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// addJsExtensions: this package is imported directly by the Temporal worker
// via Node.js ESM (not webpack), which requires .js extensions on relative imports.
// Other flipped packages are only consumed via webpack and don't need this.
export default defineConfig(makeConfig({
  addJsExtensions: true,
}));
