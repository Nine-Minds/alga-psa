import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'onboardingActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('onboarding client and billing tenant-scoped query contract', () => {
  it('uses structural tenant scoping for client, contact, and billing setup roots', () => {
    const section = sectionBetween('export const createClient', 'export const configureTicketing');

    expect(section).toContain("tenantScopedTable('clients')");
    expect(section).toContain("tenantScopedTable('client_locations')");
    expect(section).toContain("table: 'contacts'");
    expect(section).toContain("tenantScopedTable('service_types')");
    expect(section).toContain("tenantScopedTable('default_billing_settings')");
    expect(section).toContain("await trx('client_locations').insert({");
    expect(section).toContain("await trx('service_catalog').insert({");
    expect(section).toContain("await trx('service_prices').insert({");

    expect(section).not.toMatch(/trx\('(clients|client_locations|contacts|service_types|default_billing_settings)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(section).not.toMatch(/trx\('default_billing_settings'\)\.where\(\{\s*tenant\s*\}\)/);
  });
});
