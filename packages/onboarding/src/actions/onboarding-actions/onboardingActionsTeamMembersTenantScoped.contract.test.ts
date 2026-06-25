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
    expect(section).toContain("tenantScopedTable('users')");
    expect(section).toContain("tenantScopedTable('roles')");
    expect(section).toContain("await trx('users').insert({");
    expect(section).toContain("await trx('user_roles').insert({");

    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
  });
});
