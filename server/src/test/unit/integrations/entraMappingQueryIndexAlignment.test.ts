import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const migrationPath = path.join(
  repoRoot,
  'ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs'
);
const previewServicePath = path.join(
  repoRoot,
  'ee/server/src/lib/integrations/entra/mapping/mappingPreviewService.ts'
);
const confirmServicePath = path.join(
  repoRoot,
  'ee/server/src/lib/integrations/entra/mapping/confirmMappingsService.ts'
);

describe('Entra mapping query/index alignment', () => {
  it('T030: keeps preview and mapping lookups aligned to tenant-prefixed indexes', () => {
    const migrationSql = readFileSync(migrationPath, 'utf8');
    const previewSource = readFileSync(previewServicePath, 'utf8');
    const confirmSource = readFileSync(confirmServicePath, 'utf8');

    expect(migrationSql).toContain('idx_entra_managed_tenants_tenant_last_seen');
    expect(migrationSql).toContain('idx_entra_managed_tenants_tenant_primary_domain');
    expect(migrationSql).toContain(
      'ON entra_managed_tenants (tenant, lower(primary_domain))'
    );
    expect(migrationSql).toContain('ux_entra_client_tenant_mappings_active');
    expect(migrationSql).toContain(
      'ON entra_client_tenant_mappings (tenant, managed_tenant_id)'
    );

    expect(previewSource).toMatch(
      /knex\('entra_managed_tenants'\)\s*\.where\(\{\s*tenant\s*\}\)/s
    );
    expect(previewSource).toContain(
      ".orderByRaw('coalesce(display_name, entra_tenant_id) asc')"
    );
    expect(confirmSource).toMatch(
      /trx\('entra_client_tenant_mappings'\)\s*\.where\(\{\s*tenant:\s*params\.tenant,\s*managed_tenant_id:\s*managedTenantId,\s*is_active:\s*true,\s*\}\)/s
    );
  });
});
