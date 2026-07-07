import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const delegatorSource = readFileSync(resolve(__dirname, 'teamsNotificationDelivery.ts'), 'utf8');
const eeImplSource = readFileSync(
  resolve(
    __dirname,
    '../../../../ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts'
  ),
  'utf8'
);

describe('Teams notification delivery tenant-scoped query contract', () => {
  it('keeps the shared module a logic-free delegator across the edition seam', () => {
    expect(delegatorSource).toContain("import('@alga-psa/ee-stubs/lib/notifications/teamsNotificationDelivery')");
    expect(delegatorSource).not.toContain('tenantDb(');
    expect(delegatorSource).not.toContain('teamwork/sendActivityNotification');
    expect(delegatorSource).not.toContain('tenant_addons');
  });

  it('uses structural tenant scoping for Teams delivery roots in the EE implementation', () => {
    expect(eeImplSource).toContain("tenantDb(knex, tenant).table<TeamsIntegrationRow>('teams_integrations')");
    expect(eeImplSource).toContain("tenantDb(knex, tenant).table('tenant_addons')");
    expect(eeImplSource).toContain("tenantDb(knex, tenant).table<MicrosoftProfileRow>('microsoft_profiles')");

    expect(eeImplSource).not.toContain('createTenantScopedQuery');
    expect(eeImplSource).not.toMatch(
      /\bknex\('(teams_integrations|tenant_addons|microsoft_profiles)'\)\s*[\r\n]*\s*\.where\(\{[^}]*tenant/
    );
  });
});
