import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('low-risk billing tenant-scoped query contract', () => {
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
  });

  it('uses tenantDb for small billing model roots', () => {
    const fixedConfig = readSource('packages/billing/src/models/contractLineServiceFixedConfig.ts');
    const bucketConfig = readSource('packages/billing/src/models/contractLineServiceBucketConfig.ts');
    const serviceConfiguration = readSource('packages/billing/src/models/contractLineServiceConfiguration.ts');
    const usageConfig = readSource('packages/billing/src/models/contractLineServiceUsageConfig.ts');
    const contractLine = readSource('packages/billing/src/models/contractLine.ts');
    const serviceType = readSource('packages/billing/src/models/serviceType.ts');

    expect(fixedConfig).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(bucketConfig).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(serviceConfiguration).toContain('tenantDb(this.knex, this.tenant).table(table)');
    expect(serviceConfiguration).toContain("tenantDb(trx, this.tenant).table('invoice_charge_details')");

    expect(usageConfig).toContain('tenantDb(this.knex, tenant).table(table)');
    expect(contractLine).toContain('tenantDb(conn, tenant).table<Row>(table)');
    expect(serviceType).toContain('tenantDb(conn, tenant).table<Row>(TABLE_NAME)');
  });
});
