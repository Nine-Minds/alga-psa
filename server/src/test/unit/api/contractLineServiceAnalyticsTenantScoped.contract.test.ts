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

describe('contract line service analytics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for analytics aggregate roots', () => {
    const analyticsSection = sectionBetween('// ANALYTICS AND REPORTING', '// PRIVATE HELPER METHODS');

    expect(analyticsSection).toContain('tenantDb(');
    expect(analyticsSection).toContain(".table('contract_lines as cl')");
    expect(analyticsSection).toContain(".table('contract_line_service_configuration as psc')");
    expect(analyticsSection).toContain(".table('contract_lines')");
    expect(analyticsSection).toContain(".table('contracts')");
    expect(analyticsSection).toContain(".andOn('psc.tenant', '=', 'sc.tenant')");

    expect(analyticsSection).not.toMatch(/knex\('contract_lines as cl'\)\s*\./);
    expect(analyticsSection).not.toMatch(/knex\('contract_line_service_configuration as psc'\)\s*\./);
    expect(analyticsSection).not.toMatch(/knex\('contract_lines'\)\.where\('tenant', context\.tenant\)/);
    expect(analyticsSection).not.toMatch(/knex\('contracts'\)\.where\('tenant', context\.tenant\)/);
    expect(analyticsSection).not.toMatch(/\.where\('(?:cl\.|psc\.)?tenant', context\.tenant\)/);
  });
});
