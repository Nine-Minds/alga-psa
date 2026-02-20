import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra mapping/disconnect contract checks', () => {
  it('T026: unmap route deactivates/remaps mapping without touching sync run history tables', () => {
    const unmapRoute = readRepoFile('ee/server/src/app/api/integrations/entra/mappings/unmap/route.ts');

    expect(unmapRoute).toContain("mapping_state: 'unmapped'");
    expect(unmapRoute).toContain('is_active: false');
    expect(unmapRoute).toContain("await knex('entra_client_tenant_mappings').insert");
    expect(unmapRoute).not.toContain('entra_sync_runs');
    expect(unmapRoute).not.toContain('entra_sync_run_tenants');
    expect(unmapRoute.toLowerCase()).not.toContain('delete from');
  });

  it('T027: remap route delegates mapped target client and client linkage update path exists', () => {
    const remapRoute = readRepoFile('ee/server/src/app/api/integrations/entra/mappings/remap/route.ts');
    const confirmMappingsService = readRepoFile(
      'ee/server/src/lib/integrations/entra/mapping/confirmMappingsService.ts'
    );

    expect(remapRoute).toContain('confirmEntraMappings');
    expect(remapRoute).toContain('mappingState: \'mapped\'');
    expect(remapRoute).toContain('clientId: targetClientId');

    expect(confirmMappingsService).toContain("if (mappingState === 'mapped' && clientId)");
    expect(confirmMappingsService).toContain("await trx('clients')");
    expect(confirmMappingsService).toContain('entra_tenant_id: managedTenant.entra_tenant_id');
    expect(confirmMappingsService).toContain('entra_primary_domain: managedTenant.primary_domain || null');
  });

  it('T028: disconnect flow clears credentials/connection status without deleting sync run history', () => {
    const disconnectRoute = readRepoFile('ee/server/src/app/api/integrations/entra/disconnect/route.ts');
    const connectionRepository = readRepoFile(
      'ee/server/src/lib/integrations/entra/connectionRepository.ts'
    );

    expect(disconnectRoute).toContain('clearEntraDirectTokenSet');
    expect(disconnectRoute).toContain('clearEntraCippCredentials');
    expect(disconnectRoute).toContain('disconnectActiveEntraConnection');
    expect(connectionRepository).toContain("status: 'disconnected'");

    const combined = `${disconnectRoute}\n${connectionRepository}`.toLowerCase();
    expect(combined).not.toContain('entra_sync_runs');
    expect(combined).not.toContain('entra_sync_run_tenants');
    expect(combined).not.toContain('delete from entra_sync_runs');
    expect(combined).not.toContain('delete from entra_sync_run_tenants');
  });

  it('T062: confirm writes only provided mappings and preview route stays read-only', () => {
    const confirmRoute = readRepoFile('ee/server/src/app/api/integrations/entra/mappings/confirm/route.ts');
    const previewRoute = readRepoFile('ee/server/src/app/api/integrations/entra/mappings/preview/route.ts');
    const confirmMappingsService = readRepoFile(
      'ee/server/src/lib/integrations/entra/mapping/confirmMappingsService.ts'
    );

    expect(confirmRoute).toContain('const mappings = Array.isArray(body.mappings) ? body.mappings : null;');
    expect(confirmRoute).toContain('mappings must be an array');
    expect(confirmRoute).toContain('confirmEntraMappings');

    expect(confirmMappingsService).toContain('for (const mapping of params.mappings)');
    expect(confirmMappingsService).toContain('if (params.mappings.length === 0)');
    expect(confirmMappingsService).toContain('return { confirmedMappings: 0 };');
    expect(confirmMappingsService).not.toContain('buildEntraMappingPreview');

    expect(previewRoute).toContain('buildEntraMappingPreview');
    expect(previewRoute).not.toContain('confirmEntraMappings');
    expect(previewRoute).not.toContain('.insert(');
    expect(previewRoute).not.toContain('.update(');
  });
});
