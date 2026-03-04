import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['services/**/*.test.ts', '**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../packages/db/src/index.ts') },
      {
        find: /^@alga-psa\/db\/admin$/,
        replacement: path.resolve(__dirname, '../packages/db/src/lib/admin.ts'),
      },
      {
        find: /^@alga-psa\/db\/tenant$/,
        replacement: path.resolve(__dirname, '../packages/db/src/lib/tenant.ts'),
      },
      {
        find: /^@alga-psa\/db\/connection$/,
        replacement: path.resolve(__dirname, '../packages/db/src/lib/connection.ts'),
      },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../packages/core/src/index.ts') },
      {
        find: /^@alga-psa\/core\/logger$/,
        replacement: path.resolve(__dirname, '../packages/core/src/lib/logger.ts'),
      },
      {
        find: /^@alga-psa\/core\/secrets$/,
        replacement: path.resolve(__dirname, '../packages/core/src/lib/secrets/index.ts'),
      },
      {
        find: /^@shared\/workflow\/secrets$/,
        replacement: path.resolve(__dirname, './workflow/secrets/index.ts'),
      },
      {
        find: /^@shared\/workflow\/runtime$/,
        replacement: path.resolve(__dirname, './workflow/runtime/index.ts'),
      },
      {
        find: /^@shared\/workflow\/runtime\/(.*)$/,
        replacement: path.resolve(__dirname, './workflow/runtime/$1'),
      },
      {
        find: /^@shared\/workflow\/streams\/(.*)$/,
        replacement: path.resolve(__dirname, './workflow/streams/$1'),
      },
    ],
  },
});
