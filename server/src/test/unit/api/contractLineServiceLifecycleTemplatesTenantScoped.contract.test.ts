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

describe('contract line service lifecycle and template tenant-scoped query contract', () => {
  it('uses structural tenant scoping for lifecycle updates and template reads', () => {
    const lifecycleSection = sectionBetween(
      '// PLAN ACTIVATION AND LIFECYCLE',
      '// USAGE TRACKING AND METERING'
    );

    expect(lifecycleSection).toContain('createTenantScopedQuery(trx, {');
    expect(lifecycleSection).toContain("table: 'contract_lines'");
    expect(lifecycleSection).toContain("table: 'plan_templates'");
    expect(lifecycleSection).toContain("table: 'template_services'");

    expect(lifecycleSection).not.toMatch(/trx\('contract_lines'\)\s*\.(?:where|update|delete)/);
    expect(lifecycleSection).not.toMatch(/trx\('plan_templates'\)\s*\.(?:where|first)/);
    expect(lifecycleSection).not.toMatch(/trx\('template_services'\)\s*\.(?:where|first)/);
    expect(lifecycleSection).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
