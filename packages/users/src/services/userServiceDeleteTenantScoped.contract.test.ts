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

describe('user service delete tenant-scoped query contract', () => {
  it('uses structural tenant scoping for delete cleanup roots', () => {
    const section = sectionBetween('async delete', 'USER AUTHENTICATION & SECURITY');

    expect(section).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'user_preferences'");
    expect(section).toContain("table: 'user_roles'");
    expect(section).toContain("table: 'api_keys'");
    expect(section).toContain('table: tableName');

    expect(section).not.toMatch(/trx\('users'\)\s*\./);
    expect(section).not.toMatch(/trx\('user_preferences'\)\s*\./);
    expect(section).not.toMatch(/trx\('user_roles'\)\s*\./);
    expect(section).not.toMatch(/trx\('api_keys'\)\s*\./);
    expect(section).not.toMatch(/trx\(tableName\)\s*[\r\n]+\s*\.where\(\{\s*tenant: context\.tenant\s*\}\)/);
    expect(section).not.toMatch(/\.where\(\{\s*user_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
