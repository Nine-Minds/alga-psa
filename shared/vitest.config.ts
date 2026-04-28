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
      { find: /^@alga-psa\/storage$/, replacement: path.resolve(__dirname, '../packages/storage/src/index.ts') },
      { find: /^@alga-psa\/storage\/(.*)$/, replacement: path.resolve(__dirname, '../packages/storage/src/$1') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../packages/types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../packages/types/src/$1') },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../packages/auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/(.*)$/, replacement: path.resolve(__dirname, '../packages/auth/src/$1') },
      { find: /^@alga-psa\/authorization$/, replacement: path.resolve(__dirname, '../packages/authorization/src/index.ts') },
      { find: /^@alga-psa\/authorization\/(.*)$/, replacement: path.resolve(__dirname, '../packages/authorization/src/$1') },
      { find: /^@alga-psa\/validation$/, replacement: path.resolve(__dirname, '../packages/validation/src/index.ts') },
      { find: /^@alga-psa\/validation\/(.*)$/, replacement: path.resolve(__dirname, '../packages/validation/src/$1') },
      { find: /^@alga-psa\/event-schemas$/, replacement: path.resolve(__dirname, '../packages/event-schemas/src/index.ts') },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: path.resolve(__dirname, '../packages/event-schemas/src/$1') },
      { find: /^@alga-psa\/email$/, replacement: path.resolve(__dirname, '../packages/email/src/index.ts') },
      { find: /^@alga-psa\/email\/(.*)$/, replacement: path.resolve(__dirname, '../packages/email/src/$1') },
      { find: /^@alga-psa\/workflows$/, replacement: path.resolve(__dirname, '../ee/packages/workflows/src/index.ts') },
      { find: /^@alga-psa\/workflows\/(.*)$/, replacement: path.resolve(__dirname, '../ee/packages/workflows/src/$1') },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, './index.ts') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, './$1') },
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
      {
        find: /^@alga-psa\/db\/workDate$/,
        replacement: path.resolve(__dirname, '../packages/db/src/lib/workDate.ts'),
      },
      {
        find: /^@alga-psa\/db\/(.*)$/,
        replacement: path.resolve(__dirname, '../packages/db/src/$1'),
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
        find: /^@alga-psa\/core\/(.*)$/,
        replacement: path.resolve(__dirname, '../packages/core/src/$1'),
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
      {
        find: /^@shared\/(.*)$/,
        replacement: path.resolve(__dirname, './$1'),
      },
    ],
  },
});
