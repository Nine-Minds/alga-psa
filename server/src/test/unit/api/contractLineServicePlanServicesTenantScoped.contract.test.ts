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

describe('contract line service plan services tenant-scoped query contract', () => {
  it('uses structural tenant scoping for service configuration roots', () => {
    const serviceSection = sectionBetween('// SERVICE MANAGEMENT', '// CONTRACT MANAGEMENT');

    expect(serviceSection).toContain('tenantDb(');
    expect(serviceSection).toContain('tenantDb(');
    expect(serviceSection).toContain(".table('contract_line_service_configuration')");
    expect(serviceSection).toContain(".table('contract_line_service_configuration as psc')");

    expect(serviceSection).not.toMatch(
      /trx\('contract_line_service_configuration'\)\s*\.(?:where|first|update|delete)/
    );
    expect(serviceSection).not.toMatch(
      /knex\('contract_line_service_configuration as psc'\)\s*\./
    );
    expect(serviceSection).not.toMatch(/\.where\('tenant', context\.tenant\)/);
    expect(serviceSection).not.toMatch(/\.where\('psc\.tenant', context\.tenant\)/);
  });
});
