import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectNoDirectRoots(source: string, tables: string[]): void {
  const tablePattern = tables.join('|');
  expect(source).not.toMatch(new RegExp(`\\b(?:db|knex|trx)\\('(?:${tablePattern})(?:\\s+as\\s+[^']+)?'\\)`));
}

describe('billing action tenant facade migration contract', () => {
  it('registers tenant-owned tables migrated in this action swath', () => {
    const metadata = readSource('packages/db/src/lib/tenantTableMetadata.ts');

    for (const table of [
      'client_billing_settings',
      'clients',
      'contract_line_service_configuration',
      'contract_line_service_bucket_config',
      'contract_line_service_defaults',
      'contract_line_service_hourly_config',
      'contract_line_service_usage_config',
      'contract_line_services',
      'contract_lines',
      'contract_pricing_schedules',
      'contract_template_line_defaults',
      'contract_template_line_fixed_config',
      'contract_template_line_service_bucket_config',
      'contract_template_line_service_configuration',
      'contract_template_line_service_hourly_config',
      'contract_template_line_service_usage_config',
      'contract_template_line_services',
      'contract_template_lines',
      'contract_templates',
      'contracts',
      'default_billing_settings',
      'invoices',
      'service_catalog',
      'service_prices',
      'service_types',
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

  it('uses tenantDb for contract line service action roots and joins', () => {
    const source = readSource('packages/billing/src/actions/contractLineServiceActions.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain("tenantScopedTable(trx, tenant, 'contract_template_lines')");
    expect(source).toContain("tenantScopedTable(trx, tenant, 'contract_line_services')");
    expect(source).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')");
    expect(source).toContain("facade.tenantJoin(query, 'service_catalog as sc'");
    expect(source).toContain("facade.tenantJoin(query, 'service_types as st'");

    expectNoDirectRoots(source, [
      'contract_line_services',
      'contract_lines',
      'contract_template_line_service_bucket_config',
      'contract_template_line_service_configuration',
      'contract_template_line_service_hourly_config',
      'contract_template_line_service_usage_config',
      'contract_template_line_services',
      'contract_template_lines',
      'contracts',
      'service_catalog',
      'service_prices',
      'service_types',
    ]);
  });

  it('uses tenantDb for contract line mapping action/model roots', () => {
    const actions = readSource('packages/billing/src/actions/contractLineMappingActions.ts');
    const model = readSource('packages/billing/src/models/contractLineMapping.ts');

    expect(actions).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(actions).toContain("tenantScopedTable(trx, tenant, 'contracts')");
    expect(actions).toContain("tenantScopedTable(knex, tenant, 'contract_template_lines')");
    expect(actions).toContain("tenantScopedTable(knex, tenant, 'contract_template_line_service_configuration')");
    expect(actions).toContain("facade.tenantJoin(query, 'contract_template_line_fixed_config as tfc'");

    expect(model).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(model).toContain("tenantScopedTable(db, tenant, 'contract_templates')");
    expect(model).toContain("tenantScopedTable(db, tenant, 'contract_lines')");
    expect(model).toContain("facade.tenantJoin(query, 'contract_template_line_fixed_config as tfc'");

    expectNoDirectRoots(actions, [
      'contract_line_service_bucket_config',
      'contract_line_service_configuration',
      'contract_line_service_defaults',
      'contract_line_service_hourly_config',
      'contract_line_service_usage_config',
      'contract_line_services',
      'contract_lines',
      'contract_template_line_defaults',
      'contract_template_line_fixed_config',
      'contract_template_line_service_bucket_config',
      'contract_template_line_service_configuration',
      'contract_template_line_service_hourly_config',
      'contract_template_line_service_usage_config',
      'contract_template_line_services',
      'contract_template_lines',
      'contract_templates',
      'contracts',
    ]);

    expectNoDirectRoots(model, [
      'contract_lines',
      'contract_template_line_fixed_config',
      'contract_template_lines',
      'contract_templates',
      'contracts',
    ]);
  });

  it('uses tenantDb for contract action summary/assignment/overview roots', () => {
    const source = readSource('packages/billing/src/actions/contractActions.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain("facade.tenantJoin(query, 'client_contracts as cc'");
    expect(source).toContain("facade.tenantJoin(query, 'default_billing_settings as dbs'");
    expect(source).toContain("facade.tenantJoin(lineQuery, 'contract_template_line_fixed_config as tfc'");
    expect(source).toContain("facade.tenantJoin(serviceQuery, 'service_catalog as s'");
    expect(source).toContain("tenantScopedTable(knex, tenant, 'contract_line_service_configuration as config')");

    expectNoDirectRoots(source, [
      'client_contracts',
      'clients',
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_lines',
      'contract_template_line_fixed_config',
      'contract_template_line_service_configuration',
      'contract_template_line_services',
      'contract_template_lines',
      'contract_templates',
      'contracts',
      'default_billing_settings',
      'service_catalog',
    ]);
  });

  it('uses tenantDb for contract line repository clone inserts', () => {
    const source = readSource('packages/billing/src/repositories/contractLineRepository.ts');
    const cloneSection = source.slice(
      source.indexOf('export async function ensureTemplateLineSnapshot'),
      source.indexOf('export async function addContractLine'),
    );

    expect(cloneSection).toContain("tenantScopedTable(knex, tenant, 'contract_template_lines').insert");
    expect(cloneSection).toContain("tenantScopedTable(trx, tenant, 'contract_lines').insert");
    expect(cloneSection).toContain("tenantScopedTable(trx, tenant, 'contract_line_service_configuration').insert");
    expect(cloneSection).toContain("tenantScopedTable(trx, tenant, 'contract_line_service_defaults').insert");

    expectNoDirectRoots(cloneSection, [
      'contract_line_service_bucket_config',
      'contract_line_service_configuration',
      'contract_line_service_defaults',
      'contract_line_service_hourly_config',
      'contract_line_service_usage_config',
      'contract_line_services',
      'contract_lines',
      'contract_template_lines',
    ]);
  });
});
