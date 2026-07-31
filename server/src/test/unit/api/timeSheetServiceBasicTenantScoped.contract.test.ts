import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TimeSheetService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('time sheet service basic tenant-scoped query contract', () => {
  it('uses structural tenant scoping for get, update, and delete roots', () => {
    const getSection = sectionBetween('async getById', 'async getWithDetails');
    const mutationSection = sectionBetween('async update(', '// Time sheet workflow operations');

    expect(getSection).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(getSection).not.toMatch(/knex\(this\.tableName\)\s*\./);
    expect(getSection).not.toMatch(/\[\`\$\{this\.tableName\}\.tenant`\]: context\.tenant/);

    expect(mutationSection).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(mutationSection).not.toMatch(/trx\(this\.tableName\)\s*[\r\n]+\s*\.where/);
    expect(mutationSection).not.toMatch(/\.where\(\{\s*\[this\.primaryKey\]: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
