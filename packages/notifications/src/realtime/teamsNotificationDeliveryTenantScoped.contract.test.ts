import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'teamsNotificationDelivery.ts'), 'utf8');

describe('Teams notification delivery tenant-scoped query contract', () => {
  it('uses structural tenant scoping for Teams delivery roots', () => {
    expect(source).toContain("tenantDb(knex, tenant).table<TeamsIntegrationRow>('teams_integrations')");
    expect(source).toContain("tenantDb(knex, tenant).table('tenant_addons')");
    expect(source).toContain("tenantDb(knex, tenant).table<MicrosoftProfileRow>('microsoft_profiles')");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\bknex\('(teams_integrations|tenant_addons|microsoft_profiles)'\)\s*[\r\n]*\s*\.where\(\{[^}]*tenant/);
  });
});
