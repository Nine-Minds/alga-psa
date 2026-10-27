import { describe, expect, it } from 'vitest';
import { TENANT_TABLE_MANIFEST } from '../../../../../packages/db/src/lib/tenantTableManifest';
import { validateDeletionOrder } from '../../../../../scripts/validate-tenant-management';

describe('tenant deletion manifest coverage', () => {
  it('every excluded manifest entry carries a reason', () => {
    for (const entry of TENANT_TABLE_MANIFEST.filter(e => e.deletion === 'excluded')) {
      expect(entry.reason, entry.table).toBeTruthy();
    }
  });

  it('exports the DB-driven validation loop from validate-tenant-management', () => {
    expect(typeof validateDeletionOrder).toBe('function');
  });

  // Needs a migrated database: HOTPATH-style env (DB_HOST/DB_PORT/DB_NAME_SERVER/...).
  it.skipIf(process.env.VALIDATE_TENANT_DB !== '1')('DB tenant tables are all covered by the manifest with no FK violations', async () => {
    const result = await validateDeletionOrder();
    expect(result.missingTables).toEqual([]);
    expect(result.fkOrderingViolations).toEqual([]);
    expect(result.manifestProblems).toEqual([]);
    expect(result.success).toBe(true);
  }, 120_000);
});
