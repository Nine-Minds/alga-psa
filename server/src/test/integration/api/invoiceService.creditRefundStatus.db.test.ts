import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { createWorkspaceTestDbConnection } from '../../../../../packages/db/test-utils/workspaceConnection';

/**
 * T010/T011 (alga-2026-0003329): the REST InvoiceService credit-apply and
 * refund paths derive invoice status with the shared deriveInvoiceStatus, so
 * they agree with applyCreditToInvoiceInternal. Runs real code inside a
 * rolled-back transaction on the isolated workspace DB (TEST_DB_NAME,
 * DB_PASSWORD_SERVER). Amounts are cents throughout.
 */
let connection: Knex;
let active: { trx: Knex.Transaction; tenant: string; user: IUser } | undefined;

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => {
    if (!active) throw new Error('Fixture is not active');
    return { knex: active.trx, tenant: active.tenant };
  },
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: async () => {}, publishWorkflowEvent: async () => {}, publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('../../../lib/eventBus/publishers', () => ({ publishEvent: async () => {}, publishWorkflowEvent: async () => {}, publishUnregisteredEventType: async () => {} }));
vi.mock('@alga-psa/billing/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: async () => {}, enqueueExternalPaymentPush: async () => {},
  enqueueCreditApplication: async () => {}, enqueueInvoiceVoid: async () => {},
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceTerminalStatusHandlers', () => ({ notifyInvoiceTerminalStatus: async () => {} }));

import { runWithTenant } from '@alga-psa/db';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { applyCreditToInvoiceInternal } from '@alga-psa/billing/actions/creditActions';

beforeAll(() => { connection = createWorkspaceTestDbConnection(); });
afterAll(async () => { await connection?.destroy(); });

async function fixture(trx: Knex.Transaction, total: number, credit: number, payments: number[]) {
  const tenant = randomUUID(), client = randomUUID(), invoice = randomUUID(), userId = randomUUID();
  const user = { tenant, user_id: userId, username: userId, email: `${userId}@example.invalid`, hashed_password: 'synthetic', user_type: 'internal', is_inactive: false } as IUser;
  await trx('tenants').insert({ tenant, client_name: 'REST status', email: `${tenant}@example.invalid` });
  await trx('clients').insert({ tenant, client_id: client, client_name: 'REST status client', default_currency_code: 'USD' });
  await trx('users').insert(user);
  await trx('invoices').insert({ tenant, invoice_id: invoice, client_id: client, invoice_number: `REST-${invoice}`, invoice_date: '2026-09-01', due_date: '2026-10-01', total_amount: total, subtotal: total, tax: 0, credit_applied: 0, status: 'sent', currency_code: 'USD', tax_source: 'internal', is_manual: true });
  await trx('invoice_charges').insert({ tenant, invoice_id: invoice, description: 'Eligible manual service', quantity: 1, unit_price: total, total_price: total, net_amount: total, tax_rate: 0, is_manual: true });
  if (credit > 0) {
    const transactionId = randomUUID(), now = new Date().toISOString();
    await trx('transactions').insert({ transaction_id: transactionId, tenant, client_id: client, amount: credit, type: 'credit_issuance', status: 'completed', description: 'REST status credit', created_at: now, balance_after: credit, currency_code: 'USD' });
    await trx('credit_tracking').insert({ credit_id: randomUUID(), tenant, client_id: client, transaction_id: transactionId, amount: credit, remaining_amount: credit, created_at: now, updated_at: now, is_expired: false, currency_code: 'USD' });
  }
  for (const amount of payments) {
    await trx('invoice_payments').insert({ payment_id: randomUUID(), tenant, invoice_id: invoice, amount, payment_method: 'stripe', status: 'completed' });
  }
  active = { trx, tenant, user };
  return { tenant, client, invoice, user };
}

function makeService(trx: Knex.Transaction) {
  const service = new InvoiceService();
  vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: trx });
  return service;
}

const restContext = (f: { tenant: string; user: IUser }) => ({ tenant: f.tenant, userId: f.user.user_id, user: f.user }) as any;
const status = async (trx: Knex.Transaction, f: { tenant: string; invoice: string }) =>
  (await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).first()).status;

async function inTransaction(run: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await connection.transaction();
  try { await run(trx); } finally { active = undefined; vi.restoreAllMocks(); await trx.rollback(); }
}

describe('REST InvoiceService credit/refund status uses the shared derivation', () => {
  it('T010: credit-only covered invoice is sent via REST applyCredit, same as applyCreditToInvoiceInternal', async () => {
    let internalStatus: string | undefined;
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 10000, []);
      await runWithTenant(f.tenant, () => applyCreditToInvoiceInternal(f.tenant, f.user, f.client, f.invoice, 10000));
      internalStatus = await status(trx, f);
    });
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 10000, []);
      await runWithTenant(f.tenant, () => makeService(trx).applyCredit({ invoice_id: f.invoice, credit_amount: 10000 } as any, restContext(f)));
      const invoice = await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).first();
      expect(Number(invoice.credit_applied)).toBe(10000);
      expect(invoice.status).toBe('sent');
      expect(invoice.status).toBe(internalStatus);
    });
    expect(internalStatus).toBe('sent');
  });

  it('T010: REST applyCredit on a partly paid invoice derives partially_applied, then paid when credit covers the rest', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 10000, [4000]);
      const service = makeService(trx);
      await runWithTenant(f.tenant, () => service.applyCredit({ invoice_id: f.invoice, credit_amount: 2000 } as any, restContext(f)));
      expect(await status(trx, f)).toBe('partially_applied');
      await runWithTenant(f.tenant, () => service.applyCredit({ invoice_id: f.invoice, credit_amount: 4000 } as any, restContext(f)));
      expect(await status(trx, f)).toBe('paid');
    });
  });

  it('T011: refund derives status: partial refund -> partially_applied, full refund -> sent, credit not counted as paid, cancelled kept', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 0, [10000]);
      await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).update({ status: 'paid' });
      const service = makeService(trx);
      await runWithTenant(f.tenant, () => service.recordRefund({ invoice_id: f.invoice, refund_amount: 3000, reason: 'partial' } as any, restContext(f)));
      expect(await status(trx, f)).toBe('partially_applied');
      await runWithTenant(f.tenant, () => service.recordRefund({ invoice_id: f.invoice, refund_amount: 7000, reason: 'rest' } as any, restContext(f)));
      expect(await status(trx, f)).toBe('sent');
    });
    await inTransaction(async (trx) => {
      // 5000 credit + 5000 paid covers 10000; refunding the payment leaves credit only -> sent, not paid.
      const f = await fixture(trx, 10000, 0, [5000]);
      await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).update({ status: 'paid', credit_applied: 5000 });
      await runWithTenant(f.tenant, () => makeService(trx).recordRefund({ invoice_id: f.invoice, refund_amount: 5000, reason: 'credit stays' } as any, restContext(f)));
      expect(await status(trx, f)).toBe('sent');
    });
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 0, [10000]);
      await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).update({ status: 'cancelled' });
      await runWithTenant(f.tenant, () => makeService(trx).recordRefund({ invoice_id: f.invoice, refund_amount: 10000, reason: 'cancelled keeps status' } as any, restContext(f)));
      expect(await status(trx, f)).toBe('cancelled');
    });
  });
});
