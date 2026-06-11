import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// addJsExtensions: the connector consumes this package directly under Node ESM,
// so dist relative imports need explicit .js extensions.
export default defineConfig(makeConfig({ addJsExtensions: true }));
