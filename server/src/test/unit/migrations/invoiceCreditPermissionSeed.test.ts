import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

// Regression guard for the invoice:credit RBAC seed gap: POST /api/v1/invoices/{id}/credit
// (ApiInvoiceController.applyCredit) gates on resource 'invoice' action 'credit', a
// permission no tenant ever had — so the documented manual-credit REST endpoint returned
// 403 for everyone with nothing to grant through the UI. The fix seeds the permission in
// both the dev and onboarding seeds (fresh-install path, where the migration backfill is a
// no-op because the tenant is created from seeds after migrations run) and backfills
// existing tenants via a migration.
describe('invoice:credit permission seed', () => {
  const backfillMigration = readRepoFile(
    'server',
    'migrations',
    '20260815120000_add_invoice_credit_permission.cjs',
  );
  const devPermissionSeed = readRepoFile('server', 'seeds', 'dev', '47_permissions.cjs');
  const devRolePermissionSeed = readRepoFile('server', 'seeds', 'dev', '48_role_permissions.cjs');
  const onboardingPermissionSeed = readRepoFile(
    'ee',
    'server',
    'seeds',
    'onboarding',
    'psa',
    '02_permissions.cjs',
  );
  const onboardingRoleGrants = readRepoFile(
    'ee',
    'server',
    'seeds',
    'onboarding',
    'lib',
    'roleGrants.cjs',
  );

  it('defines invoice:credit in the dev and onboarding permission seeds', () => {
    const def = `{ resource: 'invoice', action: 'credit', msp: true, client: false`;
    expect(devPermissionSeed).toContain(def);
    expect(onboardingPermissionSeed).toContain(def);
  });

  it('grants invoice:credit to the MSP Finance role in the dev and onboarding seeds', () => {
    expect(devRolePermissionSeed).toContain("'invoice:credit:msp'");
    expect(onboardingRoleGrants).toContain("'invoice:credit:msp'");
  });

  it('backfill migration seeds the permission and grants it to Admin and Finance only', () => {
    expect(backfillMigration).toContain("resource: 'invoice'");
    expect(backfillMigration).toContain("action: 'credit'");
    expect(backfillMigration).toContain("whereIn('role_name', FULL_ACCESS_ROLES)");
    expect(backfillMigration).toContain("const FULL_ACCESS_ROLES = ['Admin', 'Finance'];");
    // Idempotent: skips permissions and role grants that already exist.
    expect(backfillMigration).toContain("knex('permissions')");
    expect(backfillMigration).toContain("knex('role_permissions').insert");
  });

  it('backfill down() removes the permission and its role grants', () => {
    expect(backfillMigration).toContain("exports.down");
    expect(backfillMigration).toContain("where({ tenant, resource: 'invoice', action: 'credit' })");
  });
});
