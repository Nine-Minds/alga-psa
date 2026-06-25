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

describe('user service bulk deactivate tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the bulk user update root', () => {
    const section = sectionBetween('async bulkDeactivateUsers', 'ANALYTICS & REPORTING');

    expect(section).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(section).not.toMatch(/trx\('users'\)\s*\./);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
