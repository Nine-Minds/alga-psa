import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

// Regression guard for the opportunity RBAC seed gap: migration 20260712105000
// backfills opportunity permissions for tenants that exist at migration time, but
// on fresh installs (migrations run against an empty DB, then a tenant is created
// from the seeds — the appliance bootstrap flow) that backfill is a no-op and the
// permission seeds carried no opportunity defs — so even the MSP Admin failed the
// RBAC check ("Permission denied: opportunities read required") and the
// Opportunities page silently rendered with an empty clients list. The seeds now
// define the opportunity permissions and a backfill re-run repairs
// already-provisioned tenants.
describe('opportunity permissions seed gap', () => {
  const ACTIONS = ['create', 'read', 'update', 'delete'];

  const backfillMigration = readRepoFile(
    'server',
    'migrations',
    '20260812090000_backfill_opportunity_permissions.cjs',
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

  it('defines every opportunity action in both permission seeds', () => {
    for (const action of ACTIONS) {
      const def = `{ resource: 'opportunities', action: '${action}', msp: true, client: false`;
      expect(devPermissionSeed).toContain(def);
      expect(onboardingPermissionSeed).toContain(def);
    }
  });

  it('backfill migration grants opportunities to the MSP Admin role only', () => {
    for (const action of ACTIONS) {
      expect(backfillMigration).toContain(`action: '${action}'`);
    }

    // Grants flow to the MSP Admin role only, mirroring 20260712105000.
    expect(backfillMigration).toContain("whereIn('role_name', ['Admin'])");
    expect(backfillMigration).not.toContain("'Manager'");
    expect(backfillMigration).not.toContain("'Technician'");

    // Idempotent: skips permissions and role grants that already exist.
    expect(backfillMigration).toContain('if (!permission)');
    expect(backfillMigration).toContain('if (!existingRolePermission)');
  });
});
