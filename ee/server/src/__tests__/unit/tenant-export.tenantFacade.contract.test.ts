import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../lib/tenant-management/tenant-export.ts'),
  'utf8'
);

describe('tenant export tenant facade contract', () => {
  it('uses tenantDb for registered tenant tables and keeps dynamic export unscoped boundaries explicit', () => {
    expect(source).toContain('getTenantTableScope');
    expect(source).toContain('const scopedExportDb = tenantDb(adminKnex, tenantId);');
    expect(source).toContain(".table<TenantExportTenantRow>('tenants')");
    expect(source).toContain('return scopedDb.table<DynamicExportRow>(tableName);');
    expect(source).toContain(
      "'tenant export reads schema-discovered dynamic tables with an explicit tenant predicate'"
    );
    expect(source).not.toContain(".unscoped<TenantExportTenantRow>('tenants'");
    expect(source).not.toContain('.where({ tenant: tenantId })');
  });
});
