import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_TABLE_MANIFEST } from '../../../../../packages/db/src/lib/tenantTableManifest';
import { validateDeletionOrder } from '../../../../../scripts/validate-tenant-management';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('tenant deletion manifest coverage', () => {
  it('every excluded manifest entry carries a reason', () => {
    for (const entry of TENANT_TABLE_MANIFEST.filter(e => e.deletion === 'excluded')) {
      expect(entry.reason, entry.table).toBeTruthy();
    }
  });

  it('exports the DB-driven validation loop from validate-tenant-management', () => {
    expect(typeof validateDeletionOrder).toBe('function');
  });

  // The DB-backed half of this check (every tenant table covered, no FK
  // ordering violations) needs a migrated database, so it runs in the
  // validate-tenant-management workflow rather than here; the unit suite
  // forbids skipped tests. That workflow only runs when its path filter
  // matches, so the manifest sources must be inside that filter.
  it('validate-tenant-management workflow runs when the manifest sources change', () => {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows/validate-tenant-management.yaml'), 'utf8');
    const filter = workflow.match(/grep -qE '([^']+)'/)?.[1];
    expect(filter, 'path filter').toBeTruthy();
    const triggers = (file: string) => new RegExp(filter!).test(file);

    for (const file of [
      'packages/db/src/lib/tenantTableManifest.ts',
      'packages/db/src/lib/tenantTableMetadata.ts',
      'packages/db/src/lib/tenantTableForeignKeys.ts',
      'scripts/validate-tenant-management.ts',
      'server/migrations/20260101000000_example.cjs',
    ]) {
      expect(triggers(file), file).toBe(true);
    }
    expect(triggers('packages/db/src/lib/tenantTableManifest.golden.test.ts')).toBe(false);
    expect(triggers('packages/db/src/lib/knexfile.ts')).toBe(false);
  });
});
