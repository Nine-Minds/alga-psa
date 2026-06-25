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

describe('contract line service copy services tenant-scoped query contract', () => {
  it('uses structural tenant scoping for copy-service source configuration roots', () => {
    const copySection = sectionBetween('private async copyPlanServices', 'private async copyPlanConfigurations');

    expect(copySection).toContain('createTenantScopedQuery(trx, {');
    expect(copySection).toContain("table: 'contract_line_service_configuration'");

    expect(copySection).not.toMatch(
      /trx\('contract_line_service_configuration'\)\s*\.(?:where|first|update|delete)/
    );
    expect(copySection).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
