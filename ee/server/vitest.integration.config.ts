import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';
import unitConfig from './vitest.unit.config';

// Integration files use the EE aliases and their own disposable migrated DB.
// Browser suites have a separate process/runtime and are never Vitest inputs.
// The service-principal integration suites run the EE boundary: resolve the product
// entry to the EE implementation (the shared server alias points at the CE stub).
const eeProductAliases = [
  {
    find: '@product/service-principals/entry',
    replacement: path.resolve(__dirname, '../../packages/product-service-principals/ee/entry.ts'),
  },
];

// Route-level suites import the real CE route graph, which uses `@/lib/<x>` (server/src).
// The EE config maps a bare `@/` to ee/server/src, so add an alias only for the lib entries
// that exist solely under server/src; everything the EE tree owns keeps its mapping.
const eeLib = path.resolve(__dirname, 'src/lib');
const serverLib = path.resolve(__dirname, '../../server/src/lib');
const serverOnlyLibAliases = fs
  .readdirSync(serverLib)
  .map((entry) => entry.replace(/\.(tsx?|jsx?)$/, ''))
  .filter((name, i, all) => all.indexOf(name) === i && ![name, `${name}.ts`, `${name}.tsx`, `${name}.js`].some((f) => fs.existsSync(path.join(eeLib, f))))
  .map((name) => ({
    find: new RegExp(`^@/lib/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`),
    replacement: `${path.join(serverLib, name)}$1`,
  }));

export default defineConfig({
  ...unitConfig,
  resolve: {
    ...unitConfig.resolve,
    alias: [
      ...eeProductAliases,
      // Before the EE catch-all `@/` -> ee/server/src, but only for names the EE tree lacks.
      ...serverOnlyLibAliases,
      ...(unitConfig.resolve?.alias as any[]),
    ],
  },
  test: {
    ...unitConfig.test,
    include: ['src/__tests__/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)'],
    globalSetup: [
      path.resolve(__dirname, '../../server/vitest.globalSetup.js'),
      path.resolve(__dirname, '../../server/test-utils/workspaceDbGlobalSetup.ts'),
      path.resolve(__dirname, './vitest.globalSetup.js'),
    ],
  },
});
