import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// Imported directly by Node ESM (the shared workflow runtime), so relative
// imports in dist must carry .js extensions.
export default defineConfig(makeConfig({ addJsExtensions: true }));
