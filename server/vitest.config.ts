import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'path';

fs.mkdirSync(path.resolve(__dirname, './coverage/.tmp'), { recursive: true });

export default defineConfig({
  // The repo's tsconfig sets `jsx: "preserve"` (Next.js/SWC compiles JSX with
  // the automatic runtime). esbuild does not understand "preserve" and falls
  // back to the classic runtime, which requires `import React` in every .tsx
  // file. Newer components rely on the automatic runtime and omit that import,
  // so force esbuild to the automatic JSX runtime to match production compilation.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    // This repo keeps a large number of tests under workspace packages (e.g. ../packages/*).
    // Include them explicitly because Vitest's default include globs do not match paths outside the config root.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../packages/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../ee/packages/workflows/src/actions/**/*.{test,spec}.?(c|m)[jt]s?(x)'
    ],
    setupFiles: [path.resolve(__dirname, './src/test/setup.ts')],
    globalSetup: [path.resolve(__dirname, './vitest.globalSetup.js')],
    isolate: true,
    maxConcurrency: 1,
    // Integration suites share one test_database and drop/recreate it in
    // beforeAll; parallel files corrupt each other's bootstrap. Vitest 4
    // removed singleFork/singleThread, so state serialization explicitly —
    // fileParallelism is honored by both v3 and v4.
    fileParallelism: false,
    sequence: {
      concurrent: false,
      shuffle: true,
      // CI sets VITEST_SEED so order-dependent failures reproduce across reruns.
      seed: process.env.VITEST_SEED ? Number(process.env.VITEST_SEED) : undefined
    },
    pool: 'forks',
    poolOptions: {
      threads: {
        singleThread: true
      },
      forks: {
        singleFork: true
      }
    },
    logHeapUsage: true,
    testTimeout: 20000,
    hookTimeout: 120000,
    coverage: {
      // Opt-in via --coverage; always-on coverage made every local run pay the
      // instrumentation cost. CI enables it where reports are collected.
      enabled: false,
      provider: 'v8',
      include: [
        'src/**/*.{js,ts,jsx,tsx}',
      ],
      reportsDirectory: path.resolve(__dirname, './coverage'),
      reporter: ['text', 'html', 'lcov'],
    },
    // Must live under test.server (a top-level `server` key is Vite dev-server
    // config and is silently ignored). Inlining next-auth/next is what lets the
    // next/server stub alias below apply to next-auth's internals.
    server: {
      deps: {
        inline: [
          'next-auth',
          '@auth/core',
          'next',
          '@tiptap/react',
        ],
      },
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // shared/services/email/inboundEmailRules/aiClassifier.ts dynamically imports this
      // EE-only module which lives under packages/ee/src (not ee/server/src). Resolve it
      // explicitly before the generic '@ee' alias so Vite's import-analysis can transform
      // the shared module even in CE test runs (the import itself only executes in EE mode).
      {
        find: /^@ee\/services\/email\/inboundEmailRuleAiClassifier$/,
        replacement: path.resolve(__dirname, '../packages/ee/src/services/email/inboundEmailRuleAiClassifier.ts'),
      },
      { find: '@ee', replacement: path.resolve(__dirname, '../ee/server/src') },
      { find: '@enterprise', replacement: path.resolve(__dirname, '../packages/ee/src') },
      { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
      { find: '@alga-psa/shared', replacement: path.resolve(__dirname, '../shared') },
      // @alga-psa/search export names mirror its src layout, so a prefix alias
      // resolves all subpaths (./sql, ./indexers/*, ...) to source for Vitest.
      { find: '@alga-psa/search', replacement: path.resolve(__dirname, '../packages/search/src') },

      // Workspace packages are not guaranteed to be linked into node_modules in all dev/test setups.
      // Explicitly alias the most common @alga-psa/* modules to their source entrypoints for Vitest.
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../packages/core/src/index.ts') },
      { find: /^@alga-psa\/core\/formatters$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/formatters.ts') },
      { find: /^@alga-psa\/core\/lib\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/$1') },
      { find: /^@alga-psa\/core\/logger$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/logger.ts') },
      { find: /^@alga-psa\/core\/features$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/features.ts') },
      { find: /^@alga-psa\/core\/secrets$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/secrets/index.ts') },
      { find: /^@alga-psa\/core\/events$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/events/index.ts') },
      { find: /^@alga-psa\/core\/encryption$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/encryption.ts') },
      { find: /^@alga-psa\/core\/i18n\/config$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/i18n/config.ts') },
      { find: /^@alga-psa\/core\/context\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/context/$1') },

      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../packages/db/src/index.ts') },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/tenant$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/tenant.ts') },
      { find: /^@alga-psa\/db\/connection$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/connection.ts') },
      { find: /^@alga-psa\/db\/models$/, replacement: path.resolve(__dirname, '../packages/db/src/models/index.ts') },
      { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: path.resolve(__dirname, '../packages/db/src/models/$1') },
      // db's ./workDate export maps to src/lib/workDate (names don't mirror the
      // src layout), so a prefix alias can't reach it — alias it explicitly.
      { find: /^@alga-psa\/db\/workDate$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/workDate.ts') },

      { find: /^@alga-psa\/portal-shared$/, replacement: path.resolve(__dirname, '../packages/portal-shared/src/index.ts') },
      { find: /^@alga-psa\/portal-shared\/(.*)$/, replacement: path.resolve(__dirname, '../packages/portal-shared/src/$1') },

      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../packages/types/src/index.ts') },
      { find: /^@alga-psa\/event-schemas$/, replacement: path.resolve(__dirname, '../packages/event-schemas/src/index.ts') },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: path.resolve(__dirname, '../packages/event-schemas/src/$1') },
      { find: /^@alga-psa\/workflow-streams$/, replacement: path.resolve(__dirname, '../packages/workflow-streams/src/streams/index.ts') },
      { find: /^@alga-psa\/workflow-streams\/(.*)$/, replacement: path.resolve(__dirname, '../packages/workflow-streams/src/streams/$1') },
      { find: /^@alga-psa\/validation$/, replacement: path.resolve(__dirname, '../packages/validation/src/index.ts') },
      { find: /^@alga-psa\/licensing$/, replacement: path.resolve(__dirname, '../packages/licensing/src/index.ts') },
      { find: /^@alga-psa\/licensing\/actions$/, replacement: path.resolve(__dirname, '../packages/licensing/src/actions/index.ts') },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../packages/auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/sso\/entry$/, replacement: path.resolve(__dirname, '../packages/auth/src/components/SsoProviderButtons.tsx') },
      { find: /^@alga-psa\/auth\/session$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/session.ts') },
      { find: /^@alga-psa\/auth\/rbac$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/rbac.ts') },
      { find: /^@alga-psa\/auth\/withAuth$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/withAuth.ts') },
      { find: /^@alga-psa\/auth\/apiAuth$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/apiAuth.ts') },
      { find: /^@alga-psa\/auth\/types\/next-auth$/, replacement: path.resolve(__dirname, '../packages/auth/src/types/next-auth.ts') },
      { find: /^@alga-psa\/auth\/lib\/sso\/mspSsoResolution$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/sso/mspSsoResolution.ts') },
      { find: /^@alga-psa\/auth\/deviceFingerprint$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/deviceFingerprint.ts') },
      { find: /^@alga-psa\/auth\/ipAddress$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/ipAddress.ts') },
      { find: /^@alga-psa\/auth\/geolocation$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/geolocation.ts') },
      { find: /^@alga-psa\/auth\/twoFactorHelpers$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/twoFactorHelpers.ts') },
      { find: /^@alga-psa\/auth\/lib\/mspRememberedEmail$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/mspRememberedEmail.ts') },
      { find: /^@alga-psa\/auth\/nextAuthOptions$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/nextAuthOptions.ts') },
      { find: /^@alga-psa\/auth\/getCurrentUser$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/getCurrentUser.ts') },
      { find: /^@alga-psa\/analytics$/, replacement: path.resolve(__dirname, '../packages/analytics/src/index.ts') },
      { find: /^@alga-psa\/analytics\/(.*)$/, replacement: path.resolve(__dirname, '../packages/analytics/src/$1') },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../packages/ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../packages/ui/src/$1') },
      { find: /^@alga-psa\/billing$/, replacement: path.resolve(__dirname, '../packages/billing/src/index.ts') },
      { find: /^@alga-psa\/billing\/(.*)$/, replacement: path.resolve(__dirname, '../packages/billing/src/$1') },
      { find: /^@alga-psa\/formatting$/, replacement: path.resolve(__dirname, '../packages/formatting/src/index.ts') },
      { find: /^@alga-psa\/formatting\/(.*)$/, replacement: path.resolve(__dirname, '../packages/formatting/src/$1') },
      { find: /^@alga-psa\/projects$/, replacement: path.resolve(__dirname, '../packages/projects/src/index.ts') },
      { find: /^@alga-psa\/projects\/(.*)$/, replacement: path.resolve(__dirname, '../packages/projects/src/$1') },
      { find: /^@alga-psa\/onboarding$/, replacement: path.resolve(__dirname, '../packages/onboarding/src/index.ts') },
      { find: /^@alga-psa\/onboarding\/lib$/, replacement: path.resolve(__dirname, '../packages/onboarding/src/lib/index.ts') },
      { find: /^@alga-psa\/onboarding\/(.*)$/, replacement: path.resolve(__dirname, '../packages/onboarding/src/$1') },
      { find: /^@alga-psa\/tickets$/, replacement: path.resolve(__dirname, '../packages/tickets/src/index.ts') },
      { find: /^@alga-psa\/tickets\/(.*)$/, replacement: path.resolve(__dirname, '../packages/tickets/src/$1') },
      { find: /^@alga-psa\/authorization$/, replacement: path.resolve(__dirname, '../packages/authorization/src/index.ts') },
      { find: /^@alga-psa\/authorization\/(.*)$/, replacement: path.resolve(__dirname, '../packages/authorization/src/$1') },
      { find: /^@alga-psa\/reference-data$/, replacement: path.resolve(__dirname, '../packages/reference-data/src/index.ts') },
      { find: /^@alga-psa\/reference-data\/(.*)$/, replacement: path.resolve(__dirname, '../packages/reference-data/src/$1') },
      { find: /^@alga-psa\/reporting$/, replacement: path.resolve(__dirname, '../packages/reporting/src/index.ts') },
      { find: /^@alga-psa\/reporting\/actions$/, replacement: path.resolve(__dirname, '../packages/reporting/src/actions/index.ts') },
      { find: /^@alga-psa\/reporting\/(.*)$/, replacement: path.resolve(__dirname, '../packages/reporting/src/$1') },
      { find: /^@alga-psa\/jobs$/, replacement: path.resolve(__dirname, '../packages/jobs/src/index.ts') },
      { find: /^@alga-psa\/jobs\/fanout$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/fanout/index.ts') },
      { find: /^@alga-psa\/jobs\/runner$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/jobRunnerAccessor.ts') },
      { find: /^@alga-psa\/jobs\/handlers\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/handlers/$1') },
      { find: /^@alga-psa\/jobs\/handler-utils\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/handler-utils/$1') },
      { find: /^@alga-psa\/jobs\/runners\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/jobs/runners/$1') },
      { find: /^@alga-psa\/jobs\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/$1') },
      { find: /^@alga-psa\/teams$/, replacement: path.resolve(__dirname, '../packages/teams/src/index.ts') },
      { find: /^@alga-psa\/teams\/(.*)$/, replacement: path.resolve(__dirname, '../packages/teams/src/$1') },
      { find: /^@alga-psa\/product-extension-actions$/, replacement: path.resolve(__dirname, '../packages/product-extension-actions/oss/entry.ts') },
      { find: /^@alga-psa\/tags$/, replacement: path.resolve(__dirname, '../packages/tags/src/index.ts') },
      { find: /^@alga-psa\/tags\/(.*)$/, replacement: path.resolve(__dirname, '../packages/tags/src/$1') },
      { find: /^@alga-psa\/scheduling$/, replacement: path.resolve(__dirname, '../packages/scheduling/src/index.ts') },
      { find: /^@alga-psa\/scheduling\/(.*)$/, replacement: path.resolve(__dirname, '../packages/scheduling/src/$1') },
      { find: /^@alga-psa\/ee-calendar$/, replacement: path.resolve(__dirname, '../ee/packages/calendar/src/index.ts') },
      { find: /^@alga-psa\/ee-calendar\/(.*)$/, replacement: path.resolve(__dirname, '../ee/packages/calendar/src/$1') },
      { find: /^@alga-psa\/ee-microsoft-teams$/, replacement: path.resolve(__dirname, '../ee/packages/microsoft-teams/src/index.ts') },
      { find: /^@alga-psa\/ee-microsoft-teams\/(.*)$/, replacement: path.resolve(__dirname, '../ee/packages/microsoft-teams/src/$1') },
      { find: /^@alga-psa\/ee-stubs$/, replacement: path.resolve(__dirname, '../packages/ee/src/index.ts') },
      { find: /^@alga-psa\/ee-stubs\/(.*)$/, replacement: path.resolve(__dirname, '../packages/ee/src/$1') },
      { find: /^@alga-psa\/workflows$/, replacement: path.resolve(__dirname, '../ee/packages/workflows/src/index.ts') },
      { find: /^@alga-psa\/workflows\/(.*)$/, replacement: path.resolve(__dirname, '../ee/packages/workflows/src/$1') },
      { find: /^@alga-psa\/documents$/, replacement: path.resolve(__dirname, '../packages/documents/src/index.ts') },
      { find: /^@alga-psa\/documents\/(.*)$/, replacement: path.resolve(__dirname, '../packages/documents/src/$1') },
      { find: /^@alga-psa\/clients$/, replacement: path.resolve(__dirname, '../packages/clients/src/index.ts') },
      { find: /^@alga-psa\/clients\/actions$/, replacement: path.resolve(__dirname, '../packages/clients/src/actions/index.ts') },
      { find: /^@alga-psa\/clients\/components\/(.*)$/, replacement: path.resolve(__dirname, '../packages/clients/src/components/$1') },
      { find: /^@alga-psa\/clients\/(.*)$/, replacement: path.resolve(__dirname, '../packages/clients/src/$1') },
      { find: /^@alga-psa\/assets$/, replacement: path.resolve(__dirname, '../packages/assets/src/index.ts') },
      { find: /^@alga-psa\/assets\/(.*)$/, replacement: path.resolve(__dirname, '../packages/assets/src/$1') },
      { find: /^@alga-psa\/surveys$/, replacement: path.resolve(__dirname, '../packages/surveys/src/index.ts') },
      { find: /^@alga-psa\/surveys\/(.*)$/, replacement: path.resolve(__dirname, '../packages/surveys/src/$1') },
      { find: /^@alga-psa\/integrations$/, replacement: path.resolve(__dirname, '../packages/integrations/src/index.ts') },
      { find: /^@alga-psa\/integrations\/(.*)$/, replacement: path.resolve(__dirname, '../packages/integrations/src/$1') },
      { find: /^@alga-psa\/client-portal$/, replacement: path.resolve(__dirname, '../packages/client-portal/src/index.ts') },
      { find: /^@alga-psa\/client-portal\/(.*)$/, replacement: path.resolve(__dirname, '../packages/client-portal/src/$1') },
      { find: /^@alga-psa\/jobs$/, replacement: path.resolve(__dirname, '../packages/jobs/src/index.ts') },
      { find: /^@alga-psa\/jobs\/fanout$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/fanout/index.ts') },
      { find: /^@alga-psa\/jobs\/runner$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/jobRunnerAccessor.ts') },
      { find: /^@alga-psa\/jobs\/handlers\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/handlers/$1') },
      { find: /^@alga-psa\/jobs\/handler-utils\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/handler-utils/$1') },
      { find: /^@alga-psa\/jobs\/runners\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/lib/jobs/runners/$1') },
      { find: /^@alga-psa\/jobs\/(.*)$/, replacement: path.resolve(__dirname, '../packages/jobs/src/$1') },
      { find: /^@alga-psa\/sla$/, replacement: path.resolve(__dirname, '../packages/sla/src/index.ts') },
      { find: /^@alga-psa\/sla\/(.*)$/, replacement: path.resolve(__dirname, '../packages/sla/src/$1') },
      { find: /^@alga-psa\/sla\/services\/(.*)$/, replacement: path.resolve(__dirname, '../packages/sla/src/services/$1') },
      { find: /^@alga-psa\/sla\/types$/, replacement: path.resolve(__dirname, '../packages/sla/src/types/index.ts') },
      { find: /^@alga-psa\/tenancy$/, replacement: path.resolve(__dirname, '../packages/tenancy/src/index.ts') },
      { find: /^@alga-psa\/tenancy\/actions$/, replacement: path.resolve(__dirname, '../packages/tenancy/src/actions/index.ts') },
      { find: /^@alga-psa\/tenancy\/(.*)$/, replacement: path.resolve(__dirname, '../packages/tenancy/src/$1') },

      { find: /^@alga-psa\/media$/, replacement: path.resolve(__dirname, '../packages/media/src/index.ts') },
      { find: /^@alga-psa\/storage$/, replacement: path.resolve(__dirname, '../packages/storage/src/index.ts') },
      { find: /^@alga-psa\/storage\/(.*)$/, replacement: path.resolve(__dirname, '../packages/storage/src/$1') },

      { find: /^@alga-psa\/users$/, replacement: path.resolve(__dirname, '../packages/users/src/index.ts') },
      { find: /^@alga-psa\/users\/actions$/, replacement: path.resolve(__dirname, '../packages/users/src/actions/index.ts') },
      { find: /^@alga-psa\/user-composition$/, replacement: path.resolve(__dirname, '../packages/user-composition/src/index.ts') },
      { find: /^@alga-psa\/user-composition\/actions$/, replacement: path.resolve(__dirname, '../packages/user-composition/src/actions/index.ts') },
      { find: /^@alga-psa\/user-composition\/(.*)$/, replacement: path.resolve(__dirname, '../packages/user-composition/src/$1') },

      { find: /^@alga-psa\/event-bus\/publishers$/, replacement: path.resolve(__dirname, '../packages/event-bus/src/publishers/index.ts') },
      { find: /^@alga-psa\/event-bus$/, replacement: path.resolve(__dirname, '../packages/event-bus/src/index.ts') },
      { find: /^@alga-psa\/event-bus\/(.*)$/, replacement: path.resolve(__dirname, '../packages/event-bus/src/$1') },
      { find: /^@alga-psa\/notifications$/, replacement: path.resolve(__dirname, '../packages/notifications/src/index.ts') },
      { find: /^@alga-psa\/notifications\/(.*)$/, replacement: path.resolve(__dirname, '../packages/notifications/src/$1') },
      { find: /^@alga-psa\/email$/, replacement: path.resolve(__dirname, '../packages/email/src/index.ts') },
      { find: /^@alga-psa\/email\/(.*)$/, replacement: path.resolve(__dirname, '../packages/email/src/$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../packages/core/src/index.ts') },
      { find: /^@alga-psa\/core\/server$/, replacement: path.resolve(__dirname, '../packages/core/src/server.ts') },
      { find: /^@alga-psa\/core\/config\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/config/$1') },
      { find: /^@alga-psa\/core\/constants\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/constants/$1') },
      { find: /^@alga-psa\/core\/types\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/types/$1') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/$1') },

      { find: 'fs', replacement: 'node:fs' },
      { find: 'fs/promises', replacement: 'node:fs/promises' },
      // Route the bare `redis` specifier to a never-connecting stub. Modules
      // loaded outside Vite's transform scope (e.g. hocuspocus/*.js at the repo
      // root) import `createClient` directly and bypass per-test vi.mock('redis'),
      // so the real client would open a live connection and hang unit tests.
      // Tests that need specific Redis behavior still override this with their
      // own vi.mock/vi.doMock('redis').
      { find: /^redis$/, replacement: path.resolve(__dirname, './src/test/stubs/redis.ts') },
      { find: 'next/server', replacement: path.resolve(__dirname, './src/test/stubs/next-server.ts') },
      { find: /^ajv\/dist\/2020$/, replacement: path.resolve(__dirname, '../node_modules/ajv/dist/2020.js') },
      {
        find: /^ajv\/dist\/refs\/json-schema-draft-07\.json$/,
        replacement: path.resolve(__dirname, '../node_modules/ajv/dist/refs/json-schema-draft-07.json'),
      },
      { find: '@tiptap/extension-collaboration-caret', replacement: path.resolve(__dirname, './src/test/stubs/tiptap-collaboration-caret.ts') },
      // BubbleMenu/FloatingMenu need a live ProseMirror view; stub them so toolbar
      // children render inline in jsdom. Component-side imports of this subpath are
      // not reliably caught by per-test vi.mock (cross-package resolution), so alias
      // it globally for tests.
      { find: '@tiptap/react/menus', replacement: path.resolve(__dirname, './src/test/stubs/tiptap-react-menus.tsx') },
      { find: 'emoticon', replacement: path.resolve(__dirname, './src/test/stubs/emoticon.ts') },
      { find: '@product/settings-extensions/entry', replacement: path.resolve(__dirname, './src/test/stubs/product-settings-extensions-entry.ts') },
      { find: '@product/chat/entry', replacement: path.resolve(__dirname, './src/test/stubs/product-chat-entry.ts') },
      { find: '@product/billing/entry', replacement: path.resolve(__dirname, './src/test/stubs/product-billing-entry.tsx') },
      { find: 'pdf-lib', replacement: 'empty-module' },
    ],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  ssr: {
    noExternal: [],
  },
});
