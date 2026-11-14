import { defineConfig } from 'tsup';
import { makeConfig } from '../../build-tools/tsup-preset';

// addJsExtensions: loaded directly by Node.js ESM via the algasim host.
export default defineConfig(makeConfig({
  addJsExtensions: true,
}));
