import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/ContractLineService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('contract line service usage tenant-scoped query contract', () => {
  it('uses structural tenant scoping for usage-metering roots', () => {
    const usageSection = sectionBetween('// USAGE TRACKING AND METERING', '// BULK OPERATIONS');

    expect(usageSection).toContain('tenantDb(');
    expect(usageSection).toContain(".table('bucket_usage')");
    expect(usageSection).toContain(".table('time_entries as te')");

    expect(usageSection).not.toMatch(/knex\('bucket_usage'\)\s*\./);
    expect(usageSection).not.toMatch(/knex\('time_entries as te'\)\s*\./);
    expect(usageSection).not.toMatch(/\.where\('(?:te\.)?tenant', context\.tenant\)/);
  });
});
