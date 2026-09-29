import { afterAll, expect, it } from 'vitest';
import { getAdminConnection, destroyAdminConnection } from '@alga-psa/db/admin';

afterAll(destroyAdminConnection);
it('executes a query through the configured integration database connection', async () => {
  const db = await getAdminConnection();
  const result = await db.raw('select 1 as test');
  expect(result.rows[0].test).toBe(1);
});
