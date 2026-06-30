'use server';

import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

export const resolveClientBillingCurrency = withAuth(async (user, { tenant }, clientId: string, asOfDate?: string): Promise<string> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: Cannot resolve client billing currency');
  }
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const effectiveDate = asOfDate || Temporal.Now.plainDateISO().toString();

  const client = await db.table('clients')
    .where({ client_id: clientId })
    .select('default_currency_code')
    .first();

  const currenciesQuery = db.table('client_contracts as cc');
  db.tenantJoin(currenciesQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
  const currencies = await currenciesQuery
    .where({
      'cc.client_id': clientId,
      'cc.is_active': true
    })
    .where('cc.start_date', '<=', effectiveDate)
    .where(function () {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', effectiveDate);
    })
    .whereNotNull('c.currency_code')
    .distinct('c.currency_code');

  const unique = Array.from(new Set(currencies.map((r: any) => r.currency_code).filter(Boolean)));
  if (unique.length > 1) {
    throw new Error(`Client has active contracts in multiple currencies (${unique.join(', ')}).`);
  }

  if (unique[0]) return unique[0];
  if (client?.default_currency_code) return client.default_currency_code;

  // Fall back to tenant-level billing settings default currency
  const billingSettings = await db.table('default_billing_settings')
    .select('default_currency_code')
    .first();

  return billingSettings?.default_currency_code || 'USD';
});
