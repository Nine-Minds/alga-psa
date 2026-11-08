import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
  root,
  test: { include: ['scripts/dev/co-managed-fixtures/fixtures.test.ts'], environment: 'node' },
  resolve: { alias: [
    { find: /^@alga-psa\/auth\/rbac$/, replacement: path.resolve(root, 'packages/auth/src/lib/rbac.ts') },
    { find: /^@alga-psa\/db\/models\/user$/, replacement: path.resolve(root, 'packages/db/src/models/user.ts') },
  ] },
});
