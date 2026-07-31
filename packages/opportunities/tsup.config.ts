import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

export default defineConfig(makeConfig({
  jsxEnabled: true,
  // Node.js (tsx) consumers: sdk/scripts/generate-openapi.ts imports
  // '@alga-psa/opportunities/schemas' via package exports -> dist/.
  addJsExtensions: true,
  external: ['react', 'react-dom', 'next', 'next/navigation', 'next/link', 'next-auth', 'next-auth/react'],
  // The OpenAPI generator (sdk/scripts/generate-openapi.ts) loads
  // @alga-psa/opportunities/schemas directly under Node's ESM resolver,
  // which requires explicit .js extensions on relative imports.
  addJsExtensions: true,
}));
