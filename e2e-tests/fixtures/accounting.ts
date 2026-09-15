import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

/** Existing customer linkage and a finalized invoice are preconditions.
 * OAuth, service mapping, export and recovery must go through the product UI.
 */
export async function createAccountingFixture(db: Knex, sourceEmail: string, provider: {
  adapter: 'quickbooks_online' | 'xero'; realmId: string; customerId: string;
}) {
  if (!provider.realmId.trim() || !provider.customerId.trim()) throw new Error('Accounting fixture requires a provider company and customer');
  return db.transaction(async trx => {
    const actors = await createProductionBrowserActors(trx, { sourceEmail });
    const tenant = actors.primary;
    const scope = { tenant: tenant.tenantId };
    const service = { id: randomUUID(), name: `Browser accounting service ${actors.runId}`, typeId: randomUUID() };
    const invoice = { id: randomUUID(), number: `INV-PW-${randomUUID().slice(0, 8)}`, amountCents: 27500, chargeId: randomUUID() };
    await trx('service_types').insert({ ...scope, id: service.typeId, name: `Browser service type ${actors.runId}`, is_active: true });
    await trx('service_catalog').insert({ ...scope, service_id: service.id, service_name: service.name,
      custom_service_type_id: service.typeId, billing_method: 'fixed', item_kind: 'service',
      default_rate: invoice.amountCents, unit_of_measure: 'each', is_active: true,
    });
    await trx('clients').where({ ...scope, client_id: tenant.clients.primary.id })
      .update({ billing_email: tenant.portal.email, payment_terms: null });
    await trx('invoices').insert({ ...scope, client_id: tenant.clients.primary.id, invoice_id: invoice.id,
      invoice_number: invoice.number, total_amount: invoice.amountCents, subtotal: invoice.amountCents,
      tax: 0, credit_applied: 0, currency_code: 'USD', status: 'sent', invoice_type: 'invoice', is_manual: true,
      invoice_date: '2026-09-01', due_date: '2026-09-30', finalized_at: trx.fn.now(),
      created_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('invoice_charges').insert({ ...scope, invoice_id: invoice.id, item_id: invoice.chargeId,
      service_id: service.id, description: service.name, quantity: 1, unit_price: invoice.amountCents,
      total_price: invoice.amountCents, net_amount: invoice.amountCents, tax_rate: 0, tax_amount: 0,
      is_manual: true, is_taxable: false, created_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('tenant_external_entity_mappings').insert({ ...scope, integration_type: provider.adapter,
      alga_entity_type: 'client', alga_entity_id: tenant.clients.primary.id,
      external_entity_id: provider.customerId, external_realm_id: provider.realmId, sync_status: 'synced',
    });
    return { actors, tenant, service, invoice, provider };
  });
}
