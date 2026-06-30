import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePaths = {
  client: resolve(__dirname, '../../../lib/api/services/ClientService.ts'),
  project: resolve(__dirname, '../../../lib/api/services/ProjectService.ts'),
  asset: resolve(__dirname, '../../../lib/api/services/AssetService.ts'),
};

const directTenantObjectPredicate = /(?:where|andWhere)\s*\(\s*\{(?:(?!\}\s*\)).)*tenant\s*:/gs;
const directTenantStringPredicate = /\.(?:where|andWhere)\s*\(\s*['"`][^'"`]*tenant['"`]\s*,/g;

function readService(name: keyof typeof servicePaths): string {
  return readFileSync(servicePaths[name], 'utf8');
}

describe('client, project, and asset API services tenant-scoped query contract', () => {
  it('uses the tenantDb facade instead of direct tenant predicates', () => {
    for (const name of Object.keys(servicePaths) as Array<keyof typeof servicePaths>) {
      const source = readService(name);

      expect(source).toContain('tenantDb');
      expect(source).toContain('function scopedTable');
      expect(source).not.toMatch(directTenantObjectPredicate);
      expect(source).not.toMatch(directTenantStringPredicate);
    }
  });

  it('keeps high-traffic service roots and joins behind facade helpers', () => {
    const clientSource = readService('client');
    const projectSource = readService('project');
    const assetSource = readService('asset');

    expect(clientSource).toContain("let dataQuery = db.table('clients as c')");
    expect(clientSource).toContain("db.tenantJoin(dataQuery, 'users as u'");
    expect(clientSource).toContain("db.tenantJoin(dataQuery, 'client_locations as cl'");
    expect(clientSource).toContain('deleteFromTenantTableIfExists');

    expect(projectSource).toContain("db.table<IProjectStatusMapping>('project_status_mappings as psm')");
    expect(projectSource).toContain("db.tenantJoin(query, 'statuses as s'");
    expect(projectSource).toContain("db.tenantJoin(query, 'project_phases'");

    expect(assetSource).toContain("db.tenantJoin(query, 'tickets as t'");
    expect(assetSource).toContain('scopedTable(knex, context.tenant, tableName)');
    expect(assetSource).not.toContain('knex(this.tableName)');
    expect(assetSource).not.toContain('knex(tableName).insert');
  });
});
