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

describe('onboarding team-member tenant-scoped query contract', () => {
  it('uses structural tenant scoping for client info and team-member roots', () => {
    const section = sectionBetween('export const saveClientInfo', 'export const createClient');

    expect(section).toContain('tenantDb(trx, ');
    expect(section).toContain(".table('users");
    // Team-member creation moved onto addUser (O3); this section only reads users/roles
    // and writes onboarding progress, always through the structural tenant helper.
    expect(section).toContain("tenantDb(trx, tenant).table('users')");
    expect(section).toContain("tenantDb(knex, tenant).table('roles')");
    expect(section).toContain("tenantDb(trx, tenant).table('tenant_settings')");

    // No inline user/role creation with hand-rolled tenant columns.
    expect(section).not.toMatch(/trx\('user_roles'\)/);
    expect(section).not.toMatch(/trx\('users'\)\s*\.insert/);

    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
  });
});
