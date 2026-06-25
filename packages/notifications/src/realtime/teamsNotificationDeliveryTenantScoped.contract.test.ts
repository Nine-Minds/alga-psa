import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'teamsNotificationDelivery.ts'), 'utf8');

describe('Teams notification delivery tenant-scoped query contract', () => {
  it('uses structural tenant scoping for Teams delivery roots', () => {
    expect(source).toContain("table: 'teams_integrations'");
    expect(source).toContain("table: 'tenant_addons'");
    expect(source).toContain("table: 'microsoft_profiles'");

    expect(source).not.toMatch(/\bknex\('(teams_integrations|tenant_addons|microsoft_profiles)'\)\s*[\r\n]*\s*\.where\(\{[^}]*tenant/);
  });
});
