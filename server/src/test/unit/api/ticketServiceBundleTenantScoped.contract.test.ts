import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TicketService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('ticket service bundle tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bundle ticket and settings roots', () => {
    const bundleSection = sectionBetween('private async findBundleMasterIds', '\n}');

    expect(bundleSection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(bundleSection).toContain("tenantScopedTable(trx, 'tickets', context.tenant)");
    expect(bundleSection).toContain("tenantScopedTable(trx, 'ticket_bundle_settings', context.tenant)");

    expect(bundleSection).not.toContain(".where({ tenant })");
    expect(bundleSection).not.toContain('.where({ tenant: context.tenant })');
    expect(bundleSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*ticket_id:/);
    expect(bundleSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*master_ticket_id:/);
    expect(bundleSection).not.toMatch(/trx\('tickets'\)\s*[\r\n]+\s*\.select/);
    expect(bundleSection).not.toMatch(/trx\('ticket_bundle_settings'\)\s*[\r\n]+\s*\.where/);
  });
});
