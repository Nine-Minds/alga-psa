import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'teamsMicrosoftProviderResolution.ts'), 'utf8');

describe('Teams Microsoft provider resolution tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant integration and Microsoft profile roots', () => {
    expect(source).toContain("tenantDb(db, tenantId).table<TeamsIntegrationRow>('teams_integrations')");
    expect(source).toContain("tenantDb(db, tenantId).table<MicrosoftProfileRow>('microsoft_profiles')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain('.where({ tenant: tenantId })');
    expect(source).not.toContain('tenant: tenantId, profile_id');
  });
});
