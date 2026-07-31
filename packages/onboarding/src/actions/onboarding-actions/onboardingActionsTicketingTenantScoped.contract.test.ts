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

describe('onboarding ticketing tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticketing setup roots', () => {
    const section = sectionBetween('export const configureTicketing', 'export const validateOnboardingDefaults');

    expect(section).toContain("tenantScopedTable('next_number')");
    expect(section).toContain("tenantScopedTable('boards')");
    expect(section).toContain("tenantScopedTable('categories')");
    expect(section).toContain("tenantScopedTable('statuses')");
    expect(section).toContain("tenantScopedTable('priorities')");
    expect(section).toContain("await tenantScopedTable('next_number').insert({");
    expect(section).toContain("await tenantScopedTable('boards').insert({");
    expect(section).toContain("await tenantScopedTable('categories').insert({");
    expect(section).toContain("await tenantScopedTable('statuses').insert({");
    expect(section).toContain("await tenantScopedTable('priorities').insert({");
    expect(section).toContain(".unscoped('boards', 'columnInfo reads schema metadata, not tenant rows')");

    expect(section).not.toMatch(/trx\('(next_number|boards|categories|statuses|priorities)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(section).not.toMatch(/trx\('(next_number|boards|categories|statuses|priorities)'\)\.where\(\{\s*tenant/);
    expect(section).not.toMatch(/trx\('(next_number|boards|categories|statuses|priorities)'\)/);
  });
});
