import { defineConfig } from 'tsup';
import { makeConfig } from '../../build-tools/tsup-preset';

// addJsExtensions: the host (and its `algasim` bin) is run directly by
// Node.js ESM, not through webpack, so relative imports need .js extensions.
export default defineConfig(makeConfig({
  addJsExtensions: true,
}));
