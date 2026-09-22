import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('ticket bundle status propagation tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

  it('includes the propagation ledger in the deletion order', () => {
    // Omitting a tenant-scoped table leaves its rows behind after tenant
    // deletion and fails the validate-tenant-management CI check.
    expect(source).toContain("'ticket_bundle_status_propagations'");
  });

  it('deletes the propagation ledger before tickets', () => {
    // ticket_bundle_status_propagations FKs to tickets on both master_ticket_id
    // and child_ticket_id, so its rows have to go first.
    const propagationsIndex = source.indexOf("'ticket_bundle_status_propagations'");
    const ticketsIndex = source.indexOf("\n  'tickets',");

    expect(propagationsIndex).toBeGreaterThan(-1);
    expect(ticketsIndex).toBeGreaterThan(-1);
    expect(propagationsIndex).toBeLessThan(ticketsIndex);
  });

  it('keeps the tenant table registries in step with the deletion order', () => {
    // The registries are maintained by hand and independently; a table in one
    // and not the others is how tenant deletion has broken before.
    const metadata = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');
    const migrationMetadata = readRepoFile('server/migrations/utils/tenantDb.cjs');

    expect(metadata).toContain("ticket_bundle_status_propagations: { scope: 'tenant' }");
    expect(migrationMetadata).toContain("ticket_bundle_status_propagations: { scope: 'tenant' }");
  });
});
