import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'onboardingActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('onboarding read helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for default validation and onboarding data reads', () => {
    const section = sectionFrom('export const validateOnboardingDefaults');

    expect(section).toContain(".table('boards");
    expect(section).toContain(".table('statuses");
    expect(section).toContain(".table('roles");
    expect(section).toContain(".table('clients");
    expect(section).toContain("tenantScopedTable('boards')");
    expect(section).toContain("tenantScopedTable('categories')");
    expect(section).toContain("tenantScopedTable('statuses')");
    expect(section).toContain("tenantScopedTable('priorities')");

    expect(section).not.toMatch(/(?:trx|knex)\('(boards|statuses|roles|clients|categories|priorities)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(section).not.toMatch(/(?:trx|knex)\('(boards|statuses|roles|clients|categories|priorities)'\)\.where\(\{\s*tenant/);
  });
});
