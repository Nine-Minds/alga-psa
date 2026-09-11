import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

/** A finalized payable invoice is a precondition; payment uses the actual UI. */
export async function createPaymentFixture(db: Knex, sourceEmail: string, amountCents = 27500) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Payment fixture amount must be positive integer cents');
  return db.transaction(async trx => {
    // Resetting a vendor also clears its customer IDs. Fresh Alga tenants avoid
    // retaining external customer mappings from another payment scenario.
    const actors = await createProductionBrowserActors(trx, { sourceEmail });
    const tenant = actors.primary;
    const invoice = { id: randomUUID(), number: `INV-PW-${randomUUID().slice(0, 8)}`, amountCents };
    const scope = { tenant: tenant.tenantId, client_id: tenant.clients.primary.id };
    await trx('clients').where(scope).update({ billing_email: tenant.portal.email });
    await trx('invoices').insert({ ...scope, invoice_id: invoice.id, invoice_number: invoice.number,
      total_amount: amountCents, subtotal: amountCents, tax: 0, credit_applied: 0,
      currency_code: 'USD', status: 'sent', invoice_type: 'invoice',
      invoice_date: '2026-09-01', due_date: '2026-09-30', finalized_at: trx.fn.now(),
      created_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('invoice_charges').insert({ tenant: tenant.tenantId, invoice_id: invoice.id, item_id: randomUUID(),
      description: 'Production browser payment fixture', quantity: 1, unit_price: amountCents,
      total_price: amountCents, net_amount: amountCents, tax_rate: 0, tax_amount: 0, is_manual: true,
      created_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    await trx('payment_provider_configs').insert({ tenant: tenant.tenantId, config_id: randomUUID(),
      provider_type: 'stripe', is_enabled: true, is_default: true,
      configuration: { publishable_key: 'pk_test_algasim' }, credentials_vault_path: null,
      settings: { paymentLinkExpirationHours: 24, paymentLinksInEmails: true, sendPaymentConfirmations: false },
      created_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    return { actors, tenant, invoice };
  });
}
