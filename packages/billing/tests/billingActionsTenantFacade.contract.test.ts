import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectNoDirectRoots(source: string, tables: string[]): void {
  const tablePattern = tables.join('|');
  expect(source).not.toMatch(new RegExp(`\\b(?:knex|trx)\\('(?:${tablePattern})(?:\\s+as\\s+[^']+)?'\\)`));
}

describe('billing action tenant facade migration contract', () => {
  it('registers tenant-owned tables migrated in this action swath', () => {
    const metadata = readSource('packages/db/src/lib/tenantTableMetadata.ts');

    for (const table of [
      'client_billing_settings',
      'clients',
      'contract_line_service_configuration',
      'contract_lines',
      'contract_pricing_schedules',
      'contracts',
      'invoices',
    ]) {
      expect(metadata).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('uses tenantDb for migrated billing action roots and joins', () => {
    const pricingSchedules = readSource('packages/billing/src/actions/contractPricingScheduleActions.ts');
    expect(pricingSchedules).toContain("tenantDb(knex, tenant).table('contracts')");
    expect(pricingSchedules).toContain("db.table<IContractPricingSchedule>('contract_pricing_schedules')");
    expectNoDirectRoots(pricingSchedules, ['contracts', 'contract_pricing_schedules']);

    const serviceConfiguration = readSource('packages/billing/src/actions/contractLineServiceConfigurationActions.ts');
    expect(serviceConfiguration).toContain("db.table('contract_lines as cl')");
    expect(serviceConfiguration).toContain("db.table('contract_line_service_configuration as cfg')");
    expect(serviceConfiguration).toContain("db.tenantJoin(query, 'contract_lines as cl'");
    expect(serviceConfiguration).toContain("db.tenantJoin(query, 'contracts as c'");
    expectNoDirectRoots(serviceConfiguration, [
      'contract_line_service_configuration',
      'contract_lines',
      'contracts',
    ]);

    const inbound = readSource('packages/billing/src/actions/inboundActions.ts');
    expect(inbound).toContain('const db = tenantDb(trx, tenant);');
    expect(inbound).toContain("db.table('invoices')");
    expectNoDirectRoots(inbound, ['invoices']);

    const billingSchedule = readSource('packages/billing/src/actions/billingScheduleActions.ts');
    expect(billingSchedule).toContain("db.table('clients as c')");
    expect(billingSchedule).toContain("db.tenantJoin(query, 'client_billing_settings as s'");
    expect(billingSchedule).toContain("tenantDb(trx, tenant).table('client_billing_settings')");
    expectNoDirectRoots(billingSchedule, ['client_billing_settings', 'clients']);
  });
});
