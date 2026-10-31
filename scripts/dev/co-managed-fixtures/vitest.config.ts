import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: { include: ['scripts/dev/co-managed-fixtures/fixtures.test.ts'], environment: 'node' },
});
