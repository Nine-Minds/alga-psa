import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, 'UserService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user service enhanced query tenant-scoped contract', () => {
  it('builds the shared enhanced user query through BaseService tenant scoping', () => {
    const section = sectionBetween('private buildEnhancedUserQuery', 'private applyUserFilters');

    expect(section).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(section).not.toMatch(/knex\('users'\)\s*\./);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
