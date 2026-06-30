import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('shared infrastructure tenant facade wave 2', () => {
  it('routes migrated shared billing client roots through tenantDb', () => {
    const files = [
      'shared/billingClients/billingSchedule.ts',
      'shared/billingClients/billingSettings.ts',
      'shared/billingClients/clientCadenceScheduleRegeneration.ts',
      'shared/billingClients/clientContracts.ts',
      'shared/billingClients/clientTax.ts',
      'shared/billingClients/clients.ts',
      'shared/billingClients/contractLines.ts',
      'shared/billingClients/contracts.ts',
      'shared/billingClients/createBillingCycles.ts',
      'shared/billingClients/defaultContract.ts',
      'shared/billingClients/services.ts',
      'shared/billingClients/taxSettings.ts',
      'shared/billingClients/templateClone.ts',
    ];

    const directRootPattern =
      /\b(?:knex|knexOrTrx|trx)\s*(?:<[^>]+>)?\(\s*['`](?:client_billing_cycles|client_billing_settings|client_contracts|client_locations|client_tax_rates|client_tax_settings|clients|contract_line_service_bucket_config|contract_line_service_configuration|contract_line_service_fixed_config|contract_line_service_hourly_config|contract_line_service_usage_config|contract_line_services|contract_lines|contract_template_line_service_bucket_config|contract_template_line_service_configuration|contract_template_line_service_fixed_config|contract_template_line_service_hourly_config|contract_template_line_service_usage_config|contract_template_line_services|contract_template_lines|contracts|default_billing_settings|invoices|recurring_service_periods|service_catalog|service_categories|service_prices|service_types|tax_components|tax_rates|tenant_companies|tenant_settings|users)['`]/;

    for (const file of files) {
      const source = read(file);

      expect(source, file).toContain("tenantDb");
      expect(source, file).not.toMatch(directRootPattern);
      expect(source, file).not.toMatch(/\.where\(\{\s*tenant\s*[:,}]/);
      expect(source, file).not.toMatch(/\.(?:where|andWhere)\(\s*['`][^'`]*tenant['`]\s*,\s*tenant/);
    }

    const taxRates = read('shared/billingClients/taxRates.ts');
    expect(taxRates).toContain("tenantDb(knexOrTrx, tenant).table('tax_rates')");
    expect(taxRates).not.toMatch(/\b(?:knex|knexOrTrx|trx)\s*(?:<[^>]+>)?\(\s*['`]tax_rates['`]/);
  });

  it('uses tenantJoin for migrated shared billing client joins and subqueries', () => {
    const billingSchedule = read('shared/billingClients/billingSchedule.ts');
    expect(billingSchedule).toContain("db.tenantJoin(lastInvoicedQuery, 'invoices as i'");
    expect(billingSchedule).toContain("db.subquery('invoices')");

    const clients = read('shared/billingClients/clients.ts');
    expect(clients).toContain("db.tenantJoin(baseQuery, 'users as u'");
    expect(clients).toContain("db.tenantJoin(baseQuery, 'client_locations as cl'");
    expect(clients).toContain("db.tenantJoin(clientsQuery, 'tenant_companies as tc'");
    expect(clients).toContain("db.subquery('client_billing_cycles as cbc')");

    const clientContracts = read('shared/billingClients/clientContracts.ts');
    expect(clientContracts).toContain("db.tenantJoin(query, 'contracts as c'");
    expect(clientContracts).toContain("db.tenantJoin(query, 'default_billing_settings as dbs'");
    expect(clientContracts).toContain("db.tenantJoin(contractLinesQuery, 'contract_lines as cl'");

    const clientTax = read('shared/billingClients/clientTax.ts');
    expect(clientTax).toContain("db.tenantJoin(query, 'tax_rates as tr'");
  });

  it('routes migrated shared model and numbering roots through tenantDb', () => {
    const userModel = read('shared/models/userModel.ts');
    const tagModel = read('shared/models/tagModel.ts');
    const scheduleEntry = read('shared/models/scheduleEntry.ts');
    const numberingService = read('shared/services/numberingService.ts');

    expect(userModel).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(userModel).not.toMatch(/\b(?:knex|trx)\s*(?:<[^>]+>)?\(\s*['`](?:contacts|roles|user_roles|users)['`]/);

    expect(tagModel).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(tagModel).toContain("db.tenantJoin(query, 'tag_definitions as td'");
    expect(tagModel).not.toMatch(/\btrx\s*(?:<[^>]+>)?\(\s*['`](?:tag_definitions|tag_mappings)['`]/);

    expect(scheduleEntry).toContain("tenantScopedTable(knexOrTrx, 'schedule_entries', tenant)");
    expect(scheduleEntry).toContain("tenantScopedTable(knexOrTrx, 'schedule_entry_assignees', tenant)");
    expect(scheduleEntry).not.toMatch(/\bknexOrTrx\s*(?:<[^>]+>)?\(\s*['`](?:schedule_entries|schedule_entry_assignees)['`]/);

    expect(numberingService).toContain("const db = tenantDb(knex, tenant);");
    expect(numberingService).toContain("db.table('next_number')");
    expect(numberingService).not.toContain("knex('next_number')");
  });

  it('has metadata for the newly migrated registered roots', () => {
    const metadata = read('packages/db/src/lib/tenantTableMetadata.ts');

    for (const table of [
      'client_billing_cycles',
      'client_contracts',
      'client_tax_rates',
      'contract_template_line_services',
      'default_billing_settings',
      'next_number',
      'recurring_service_periods',
      'service_prices',
      'tag_definitions',
      'tag_mappings',
      'user_roles',
    ]) {
      expect(metadata).toContain(`${table}: { scope: 'tenant' }`);
    }
  });
});
