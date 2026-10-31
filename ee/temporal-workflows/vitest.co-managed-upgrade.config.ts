import path from 'node:path';
import base from './vitest.no-docker.config';

// The independent-upgrade workflow branch is exercised with mocked workflow/activity
// proxies: no Temporal test server, Docker socket or database is needed. The emulator
// integration test additionally needs L8B_TEST_DATABASE_URL (it is skipped without it).
const emulators = path.resolve(__dirname, '../../packages/emulators');
export default {
  ...base,
  plugins: [
    // The base config refuses workspace packages that only resolve to dist/. The emulators are
    // test-only fixtures, so map them to their source ahead of that guard.
    { name: 'l8b-emulator-source', enforce: 'pre' as const, resolveId(id: string) {
      if (id === '@alga-psa/emulator-host') return path.join(emulators, 'host/src/index.ts');
      if (id === '@alga-psa/emulator-stripe') return path.join(emulators, 'stripe/src/index.ts');
      return null;
    } },
    ...(base.plugins ?? []),
  ],
  test: {
    ...base.test,
    include: ['src/__tests__/integration/coManagedUpgradeWorkflow.test.ts', 'src/__tests__/integration/coManagedUpgradeEmulator.test.ts'],
    exclude: ['**/node_modules/**'],
  },
};
