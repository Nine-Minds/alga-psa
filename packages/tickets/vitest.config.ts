import { defineConfig } from 'vitest/config';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, '../../tsconfig.base.json')],
    }),
  ],
  test: {
    environment: 'jsdom',
    env: {
      NODE_ENV: 'test',
    },
    setupFiles: [path.resolve(__dirname, './src/test/setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../types/src/$1') },
      { find: /^@alga-psa\/event-schemas$/, replacement: path.resolve(__dirname, '../event-schemas/src/index.ts') },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: path.resolve(__dirname, '../event-schemas/src/$1') },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/$1') },
      { find: /^@alga-psa\/formatting$/, replacement: path.resolve(__dirname, '../formatting/src/index.ts') },
      { find: /^@alga-psa\/formatting\/(.*)$/, replacement: path.resolve(__dirname, '../formatting/src/$1') },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/sso\/entry$/, replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx') },
      { find: /^@alga-psa\/auth\/(.*)$/, replacement: path.resolve(__dirname, '../auth/src/$1') },
      { find: /^@alga-psa\/clients$/, replacement: path.resolve(__dirname, '../clients/src/index.ts') },
      { find: /^@alga-psa\/clients\/(.*)$/, replacement: path.resolve(__dirname, '../clients/src/$1') },
      { find: /^@alga-psa\/product-extension-actions$/, replacement: path.resolve(__dirname, '../product-extension-actions/index.ts') },
      { find: /^@alga-psa\/product-extension-actions\/(.*)$/, replacement: path.resolve(__dirname, '../product-extension-actions/$1') },
      { find: /^@alga-psa\/product-extension-initialization$/, replacement: path.resolve(__dirname, '../product-extension-initialization/index.ts') },
      { find: /^@alga-psa\/product-extension-initialization\/(.*)$/, replacement: path.resolve(__dirname, '../product-extension-initialization/$1') },
      { find: /^@alga-psa\/product-extensions$/, replacement: path.resolve(__dirname, '../product-extensions/index.ts') },
      { find: /^@alga-psa\/product-extensions\/(.*)$/, replacement: path.resolve(__dirname, '../product-extensions/$1') },
      { find: /^@alga-psa\/product-extensions-pages$/, replacement: path.resolve(__dirname, '../product-extensions-pages/oss/list.tsx') },
      { find: /^@alga-psa\/product-extensions-pages\/(.*)$/, replacement: path.resolve(__dirname, '../product-extensions-pages/$1') },
      { find: /^@alga-psa\/reference-data$/, replacement: path.resolve(__dirname, '../reference-data/src/index.ts') },
      { find: /^@alga-psa\/reference-data\/(.*)$/, replacement: path.resolve(__dirname, '../reference-data/src/$1') },
      { find: /^@alga-psa\/tags$/, replacement: path.resolve(__dirname, '../tags/src/index.ts') },
      { find: /^@alga-psa\/tags\/(.*)$/, replacement: path.resolve(__dirname, '../tags/src/$1') },
      { find: /^@alga-psa\/teams$/, replacement: path.resolve(__dirname, '../teams/src/index.ts') },
      { find: /^@alga-psa\/teams\/(.*)$/, replacement: path.resolve(__dirname, '../teams/src/$1') },
      { find: /^@alga-psa\/tickets$/, replacement: path.resolve(__dirname, './src/index.ts') },
      { find: /^@alga-psa\/tickets\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@alga-psa\/user-composition$/, replacement: path.resolve(__dirname, '../user-composition/src/index.ts') },
      { find: /^@alga-psa\/user-composition\/(.*)$/, replacement: path.resolve(__dirname, '../user-composition/src/$1') },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
      { find: /^@shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
    ],
  },
});
