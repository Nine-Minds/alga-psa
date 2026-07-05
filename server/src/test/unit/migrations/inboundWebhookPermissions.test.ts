import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

describe('inbound webhook permissions migration and seed', () => {
  const permissionMigration = readRepoFile(
    'server',
    'migrations',
    '20260511102000_add_inbound_webhook_permissions.cjs',
  );
  const devPermissionSeed = readRepoFile('server', 'seeds', 'dev', '47_permissions.cjs');

  it('T006: seeds inbound_webhook permissions for the MSP Admin role', () => {
    const expectedActions = ['create', 'read', 'update', 'delete', 'replay'];

    expect(permissionMigration).toContain("const RESOURCE = 'inbound_webhook'");
    for (const action of expectedActions) {
      expect(permissionMigration).toContain(`{ action: '${action}'`);
      expect(devPermissionSeed).toContain(`{ resource: 'inbound_webhook', action: '${action}', msp: true, client: false`);
    }

    expect(permissionMigration).toContain(".where({ tenant, role_name: 'Admin', msp: true })");
    // per-tenant writes flow through the migration tenantDb facade
    expect(permissionMigration).toContain('const db = tenantDb(knex, tenant);');
    expect(permissionMigration).toContain("await db.table('role_permissions').insert");
    expect(permissionMigration).toContain('role_id: adminRole.role_id');
    expect(permissionMigration).toContain('permission_id: permissionId');
  });

  it('T007: does not grant inbound_webhook permissions to non-admin roles by default', () => {
    expect(permissionMigration).toContain(".where({ tenant, role_name: 'Admin', msp: true })");
    expect(permissionMigration).not.toContain("role_name: 'Manager'");
    expect(permissionMigration).not.toContain("role_name: 'Technician'");
    expect(permissionMigration).not.toContain("role_name: 'Client'");
    expect(permissionMigration).not.toContain('msp: false');

    const rolePermissionInsertCount = (permissionMigration.match(/role_permissions'\)\.insert/g) ?? []).length;
    expect(rolePermissionInsertCount).toBe(1);
  });
});
