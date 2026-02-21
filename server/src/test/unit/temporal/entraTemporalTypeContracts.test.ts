import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra Temporal type contracts', () => {
  it('T069: Entra sync types are shared across workflows/activities without any leakage', () => {
    const typeFile = readRepoFile('ee/temporal-workflows/src/types/entra-sync.ts');
    expect(typeFile).toContain('export interface EntraDiscoveryWorkflowResult');
    expect(typeFile).toContain('export interface DiscoverManagedTenantsActivityInput');
    expect(typeFile).toContain('export interface EntraSyncWorkflowResult');
    expect(typeFile).toContain('export interface EntraTenantSyncResult');
    expect(typeFile).toContain('export interface FinalizeSyncRunActivityInput');

    const typedEntraFiles = [
      'ee/temporal-workflows/src/workflows/entra-discovery-workflow.ts',
      'ee/temporal-workflows/src/workflows/entra-initial-sync-workflow.ts',
      'ee/temporal-workflows/src/workflows/entra-tenant-sync-workflow.ts',
      'ee/temporal-workflows/src/workflows/entra-all-tenants-sync-workflow.ts',
      'ee/temporal-workflows/src/activities/entra-discovery-activities.ts',
      'ee/temporal-workflows/src/activities/entra-sync-activities.ts',
    ];

    for (const filePath of typedEntraFiles) {
      const source = readRepoFile(filePath);
      expect(source).toContain('types/entra-sync');
      expect(source).not.toMatch(/:\s*any\b/);
      expect(source).not.toContain('as any');
      expect(source).not.toContain('<any>');
    }
  });
});
