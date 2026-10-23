import { defineConfig } from 'vitest/config';
import path from 'path';

// Shared aliases so component tests resolve workspace packages from source
// instead of built dist output.
const workspaceAliases = [
  // next-auth's lib/env.js imports the extensionless builtin specifier
  // "next/server"; point it at the real file so a fresh install resolves.
  { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
  { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
  { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../types/src')}/$1` },
  // @alga-psa/ui publishes ./lib/* from dist, which tests do not build; the
  // boundary helper reaches lib/i18n/serverOnly, so resolve ui from source
  // the way the other packages' configs do.
  { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
  { find: /^@alga-psa\/ui\/(.*)$/, replacement: `${path.resolve(__dirname, '../ui/src')}/$1` },
  { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
  // @alga-psa/core's i18n exports live under src/lib rather than src.
  {
    find: /^@alga-psa\/core\/i18n\/(.*)$/,
    replacement: `${path.resolve(__dirname, '../core/src/lib/i18n')}/$1`,
  },
  { find: /^@alga-psa\/db\/models$/, replacement: path.resolve(__dirname, '../db/src/models/index.ts') },
  { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/models')}/$1` },
  { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1` },
  { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
  // The real tenancy actions barrel pulls server-only tenant-logo/storage
  // modules that cannot load in jsdom; Documents.tsx only needs
  // getExperimentalFeatures from it.
  {
    find: /^@alga-psa\/tenancy\/actions$/,
    replacement: path.resolve(__dirname, './tests/stubs/tenancyActions.ts'),
  },
  // Auth entry/seams referenced transitively through the ui barrel.
  {
    find: /^@alga-psa\/auth\/sso\/entry$/,
    replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx'),
  },
  { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../auth/src/index.ts') },
  { find: /^@alga-psa\/auth\/session$/, replacement: path.resolve(__dirname, '../auth/src/lib/session.ts') },
  { find: /^@alga-psa\/auth\/rbac$/, replacement: path.resolve(__dirname, '../auth/src/lib/rbac.ts') },
  { find: /^@alga-psa\/auth\/withAuth$/, replacement: path.resolve(__dirname, '../auth/src/lib/withAuth.ts') },
  { find: /^@alga-psa\/auth\/apiAuth$/, replacement: path.resolve(__dirname, '../auth/src/lib/apiAuth.ts') },
  {
    find: /^@alga-psa\/auth\/types\/next-auth$/,
    replacement: path.resolve(__dirname, '../auth/src/types/next-auth.ts'),
  },
  {
    find: /^@alga-psa\/auth\/nextAuthOptions$/,
    replacement: path.resolve(__dirname, '../auth/src/lib/nextAuthOptions.ts'),
  },
  {
    find: /^@alga-psa\/auth\/getCurrentUser$/,
    replacement: path.resolve(__dirname, '../auth/src/lib/getCurrentUser.ts'),
  },
  {
    find: /^@alga-psa\/auth\/localizeActionError$/,
    replacement: path.resolve(__dirname, '../auth/src/lib/localizeActionError.ts'),
  },
  { find: /^@alga-psa\/auth\/(.*)$/, replacement: `${path.resolve(__dirname, '../auth/src')}/$1` },
  // Product extension entries publish from oss/ee subpaths.
  {
    find: /^@alga-psa\/product-extension-actions$/,
    replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
  },
  { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
  // Enterprise (EE) seam used by dynamically imported sections.
  { find: /^@enterprise$/, replacement: path.resolve(__dirname, '../ee/src/index.ts') },
  { find: /^@enterprise\/(.*)$/, replacement: `${path.resolve(__dirname, '../ee/src')}/$1` },
  // Resolve remaining workspace packages (including self-references) from
  // source so component tests do not depend on built dist output.
  { find: /^@alga-psa\/([^/]+)\/(.*)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src/$2` },
  { find: /^@alga-psa\/([^/]+)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src` },
  { find: '@shared', replacement: path.resolve(__dirname, '../../shared') },
];

// The real storage provider imports node builtins (fs/stream) that a jsdom
// environment cannot bundle. Component tests mock the document actions, so a
// load-only stub keeps the module graph resolvable without node builtins.
const storageStubAlias = [
  { find: /^@alga-psa\/storage(\/.*)?$/, replacement: path.resolve(__dirname, './tests/stubs/storage.ts') },
];

const nodeAliases = [
  { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src') },
  { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../types/src')}/$1` },
  { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
  { find: /^@alga-psa\/ui\/(.*)$/, replacement: `${path.resolve(__dirname, '../ui/src')}/$1` },
  { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
  { find: /^@alga-psa\/db\/models$/, replacement: path.resolve(__dirname, '../db/src/models/index.ts') },
  { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/models')}/$1` },
  { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1` },
  { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
];

export default defineConfig({
  test: {
    projects: [
      {
        // Node contract suites.
        test: {
          name: 'documents-node',
          globals: true,
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          testTimeout: 10000,
        },
        resolve: { alias: nodeAliases },
      },
      {
        // jsdom component suites for the ticket upload feedback work. Broader
        // src/ suites carry their own runtime assumptions and run under the
        // root/server vitest config; keep this project scoped so
        // `npm -w @alga-psa/documents test` is a reproducible regression gate.
        test: {
          name: 'documents-upload-feedback',
          globals: true,
          environment: 'jsdom',
          include: [
            'src/components/DocumentUpload.test.tsx',
            'src/components/Documents.uploadBatch.test.tsx',
          ],
          setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
          sequence: { concurrent: false, shuffle: false },
          // Inline next-auth/@auth/core/next so vite transforms them and the
          // `next/server` alias in workspaceAliases applies.
          server: {
            deps: {
              inline: ['next-auth', '@auth/core', 'next'],
            },
          },
          testTimeout: 10000,
        },
        resolve: { alias: [...storageStubAlias, ...workspaceAliases] },
      },
    ],
  },
});
