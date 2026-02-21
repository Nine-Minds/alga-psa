import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra integration guide contracts', () => {
  const guide = readRepoFile('ee/docs/guides/entra-integration-phase-1.md');

  it('T135: docs include both direct and CIPP setup paths with decision guidance', () => {
    expect(guide).toContain('## Connection Path Decision Guide');
    expect(guide).toContain('1. `direct` (Microsoft OAuth)');
    expect(guide).toContain('2. `cipp` (CIPP API)');
    expect(guide).toContain('Choose one connection type per tenant');
  });

  it('T136: docs list Entra secret names and secret-provider/vault compatibility', () => {
    expect(guide).toContain('## Required Secret Names');
    expect(guide).toContain('microsoft_client_id');
    expect(guide).toContain('entra_direct_access_token');
    expect(guide).toContain('entra_cipp_api_token');
    expect(guide).toContain('getSecretProviderInstance()');
    expect(guide).toContain('env/filesystem/vault provider chains');
  });

  it('T137: docs describe additive non-overwrite sync behavior and field-sync toggles', () => {
    expect(guide).toContain('## Sync Behavior and Safety Rules');
    expect(guide).toContain('Default behavior is additive/linking, not destructive');
    expect(guide).toContain('Sync never deletes contacts.');
    expect(guide).toContain('Field overwrite controls');
    expect(guide).toContain('field_sync_config');
  });

  it('T138: docs include feature-flag rollout order for pilot tenants', () => {
    expect(guide).toContain('## Rollout Order (Recommended)');
    expect(guide).toContain('entra-integration-ui');
    expect(guide).toContain('entra-integration-cipp');
    expect(guide).toContain('entra-integration-field-sync');
    expect(guide).toContain('entra-integration-ambiguous-queue');
    expect(guide).toContain('entra-integration-client-sync-action');
    expect(guide).toContain('Enable tenant targeting');
  });
});
