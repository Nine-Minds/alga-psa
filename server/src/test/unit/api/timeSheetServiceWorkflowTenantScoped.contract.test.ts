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

describe('time sheet service workflow tenant-scoped query contract', () => {
  it('uses structural tenant scoping for workflow transition updates', () => {
    const workflowSection = sectionBetween('// Time sheet workflow operations', 'async addComment');

    expect(workflowSection).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(workflowSection).toContain('tenantDb(');
    expect(workflowSection).toContain(".table('time_entries')");

    expect(workflowSection).not.toMatch(/trx\(this\.tableName\)\s*[\r\n]+\s*\.where/);
    expect(workflowSection).not.toMatch(/trx\('time_entries'\)\s*[\r\n]+\s*\.where/);
    expect(workflowSection).not.toMatch(/\.where\(\{\s*id,\s*tenant: context\.tenant\s*\}\)/);
    expect(workflowSection).not.toMatch(/\.where\(\{\s*time_sheet_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
