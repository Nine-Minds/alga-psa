import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('low-risk billing tenant-scoped query contract', () => {
  it('registers low-risk billing tenant tables migrated in this swath', () => {
    const metadata = readSource('packages/db/src/lib/tenantTableMetadata.ts');

    for (const table of [
      'contract_line_presets',
      'quote_document_templates',
      'service_rate_tiers',
      'user_type_rates',
    ]) {
      expect(metadata).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('uses tenantDb for migrated action roots and joins', () => {
    const billingCurrency = readSource('packages/billing/src/actions/billingCurrencyActions.ts');
    const externalTaxImport = readSource('packages/billing/src/actions/externalTaxImportActions.ts');
    const material = readSource('packages/billing/src/actions/materialActions.ts');
    const usage = readSource('packages/billing/src/actions/usageActions.ts');
    const taxSource = readSource('packages/billing/src/actions/taxSourceActions.ts');
    const invoiceJob = readSource('packages/billing/src/actions/invoiceJobActions.ts');

    expect(billingCurrency).toContain('const db = tenantDb(knex, tenant);');
    expect(billingCurrency).toContain("db.tenantJoin(currenciesQuery, 'contracts as c'");

    expect(externalTaxImport).toContain("const query = facade.table('invoices as i')");
    expect(externalTaxImport).toContain("facade.tenantJoin(query, 'clients as c'");

    expect(material).toContain("facade.table('ticket_materials as tm')");
    expect(material).toContain("facade.tenantJoin(query, 'service_catalog as sc'");

    expect(usage).toContain("facade.table('usage_tracking')");
    expect(usage).toContain("facade.tenantJoin(query, 'clients'");
    expect(usage).toContain("facade.tenantJoin(query, 'service_catalog'");

    expect(taxSource).toContain("db.table('invoices')");
    expect(taxSource).toContain("db.table('invoice_charges')");

    expect(invoiceJob).toContain("tenantDb(knex, tenant).table('tenants')");
    expect(invoiceJob).toContain("tenantDb(knex, tenant).table<IContact>('contacts')");

    const quoteDocumentTemplates = readSource('packages/billing/src/actions/quoteDocumentTemplates.ts');
    expect(quoteDocumentTemplates).toContain("tenantScopedTable(trx, tenant, 'quote_document_templates')");

    const serviceActions = readSource('packages/billing/src/actions/serviceActions.ts');
    expect(serviceActions).toContain("tenantDb(trx, tenant).table('service_rate_tiers')");
  });

  it('uses tenantDb for small billing model roots', () => {
    const fixedConfig = readSource('packages/billing/src/models/contractLineServiceFixedConfig.ts');
    const bucketConfig = readSource('packages/billing/src/models/contractLineServiceBucketConfig.ts');
    const serviceConfiguration = readSource('packages/billing/src/models/contractLineServiceConfiguration.ts');
    const usageConfig = readSource('packages/billing/src/models/contractLineServiceUsageConfig.ts');
    const contractLine = readSource('packages/billing/src/models/contractLine.ts');
    const serviceType = readSource('packages/billing/src/models/serviceType.ts');
    const serviceRateTier = readSource('packages/billing/src/models/serviceRateTier.ts');
    const contractLinePreset = readSource('packages/billing/src/models/contractLinePreset.ts');
    const quoteDocumentTemplate = readSource('packages/billing/src/models/quoteDocumentTemplate.ts');
    const hourlyConfig = readSource('packages/billing/src/models/contractLineServiceHourlyConfig.ts');
    const templateSelection = readSource('packages/billing/src/lib/quote-template-ast/templateSelection.ts');

    expect(fixedConfig).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(bucketConfig).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(serviceConfiguration).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(serviceConfiguration).toContain("tenantDb(trx, this.tenant).table('invoice_charge_details')");

    expect(usageConfig).toContain('tenantDb(this.knex, tenant).table(table)');
    expect(contractLine).toContain('tenantDb(conn, tenant).table<Row>(table)');
    expect(serviceType).toContain('tenantDb(conn, tenant).table<Row>(TABLE_NAME)');

    expect(serviceRateTier).toContain("tenantDb(conn, tenant).table<Row>('service_rate_tiers')");
    expect(contractLinePreset).toContain("tenantDb(conn, tenant).table<IContractLinePreset>('contract_line_presets')");
    expect(quoteDocumentTemplate).toContain("tenantDb(conn, tenant).table<IQuoteDocumentTemplate>('quote_document_templates')");
    expect(hourlyConfig).toContain("this.table('user_type_rates', tenant)");
    expect(templateSelection).toContain("tenantDb(knexOrTrx, tenant).table('quote_document_templates')");
    expect(templateSelection).toContain("tenantDb(knexOrTrx, tenant).table('quote_document_template_assignments')");
  });
});
