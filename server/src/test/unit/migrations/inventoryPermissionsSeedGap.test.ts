import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

// Regression guard for the inventory RBAC seed gap: migration 20260626100600
// backfills inventory permissions for tenants that exist at migration time, but
// on fresh installs (migrations run against an empty DB, then a tenant is created
// from the seeds) that backfill is a no-op and the permission seeds carried no
// inventory defs — so even the MSP Admin failed every inventory RBAC check
// ("Permission denied: sales_order create required"). The seeds now define the
// inventory permissions and a readd migration repairs already-provisioned tenants.
describe('inventory permissions seed gap', () => {
  const INVENTORY_RESOURCES = [
    'inventory',
    'vendor',
    'purchase_order',
    'sales_order',
    'stock_transfer',
    'stock_location',
  ];

  const readdMigration = readRepoFile(
    'server',
    'migrations',
    '20260707120000_readd_inventory_permissions_for_seeded_tenants.cjs',
  );
  const devPermissionSeed = readRepoFile('server', 'seeds', 'dev', '47_permissions.cjs');
  const onboardingPermissionSeed = readRepoFile(
    'ee',
    'server',
    'seeds',
    'onboarding',
    'psa',
    '02_permissions.cjs',
  );

  it('defines every inventory resource/action in both permission seeds', () => {
    const actions = ['create', 'read', 'update', 'delete'];
    for (const resource of INVENTORY_RESOURCES) {
      for (const action of actions) {
        const def = `{ resource: '${resource}', action: '${action}', msp: true, client: false`;
        expect(devPermissionSeed).toContain(def);
        expect(onboardingPermissionSeed).toContain(def);
      }
    }
  });

  it('readd migration grants the inventory resources to the MSP Admin role only', () => {
    for (const resource of INVENTORY_RESOURCES) {
      expect(readdMigration).toContain(`'${resource}'`);
    }

    // Grants flow to the single MSP Admin role, mirroring 20260626100600.
    expect(readdMigration).toContain("whereRaw(\"LOWER(role_name) = 'admin'\")");
    expect(readdMigration).toContain('role_id: adminRole.role_id');
    expect(readdMigration).not.toContain("role_name: 'Manager'");
    expect(readdMigration).not.toContain("role_name: 'Technician'");

    // Exactly one role_permissions insert (Admin), and it is idempotent.
    const rolePermissionInsertCount = (readdMigration.match(/role_permissions'\)\n?\s*\.insert/g) ?? []).length;
    expect(rolePermissionInsertCount).toBe(1);
    expect(readdMigration).toContain('existingRolePermIds.has');
  });
});
