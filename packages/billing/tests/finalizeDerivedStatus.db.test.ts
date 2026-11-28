import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createWorkspaceTestDbConnection } from '../../db/test-utils/workspaceConnection';
import type { IUser } from '@alga-psa/types';

/**
 * T002-T004 (alga-2026-0003329): finalize derives the invoice status from the
 * net recorded payments. Same harness as financialStateModel.db.test.ts: real
 * finalize/unfinalize/payment/credit code inside a rolled-back transaction.
 * Needs the isolated workspace DB runner (TEST_DB_NAME, DB_PASSWORD_SERVER).
 */
let connection: Knex;
let active: { trx: Knex.Transaction; tenant: string; user: IUser } | undefined;
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    if (!active) throw new Error('Fixture is not active');
    return action(active.user, { tenant: active.tenant }, ...args);
  },
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => {
    if (!active) throw new Error('Fixture is not active');
    return { knex: active.trx, tenant: active.tenant };
  },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: async () => {}, publishWorkflowEvent: async () => {}, publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('../src/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: async () => {}, enqueueExternalPaymentPush: async () => {},
  enqueueCreditApplication: async () => {}, enqueueInvoiceVoid: async () => {},
}));
vi.mock('../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({ notifyInvoiceTerminalStatus: async () => {} }));

import { runWithTenant } from '@alga-psa/db';
import { finalizeInvoiceWithKnex, unfinalizeInvoice } from '../src/actions/invoiceModification';
import { grantCredit, applyCreditToInvoiceInternal } from '../src/actions/creditActions';
import { recordExternalPayment } from '../src/services/accountingSync/recordExternalPayment';
import { computeBalanceDue } from '../src/lib/balanceDue';

beforeAll(() => { connection = createWorkspaceTestDbConnection(); });
afterAll(async () => { await connection?.destroy(); });

async function fixture(trx: Knex.Transaction, total: number, availableCredit = 0) {
  const tenant = randomUUID(), client = randomUUID(), invoice = randomUUID(), userId = randomUUID();
  const user = { tenant, user_id: userId, username: userId, email: `${userId}@example.invalid`, hashed_password: 'synthetic', user_type: 'internal', is_inactive: false } as IUser;
  await trx('tenants').insert({ tenant, client_name: 'Finalize status', email: `${tenant}@example.invalid` });
  await trx('clients').insert({ tenant, client_id: client, client_name: 'Finalize status client', default_currency_code: 'USD' });
  await trx('users').insert(user);
  await trx('invoices').insert({ tenant, invoice_id: invoice, client_id: client, invoice_number: `FIN-${invoice}`, invoice_date: '2026-09-01', due_date: '2026-10-01', total_amount: total, subtotal: total, tax: 0, credit_applied: 0, status: 'draft', currency_code: 'USD', tax_source: 'internal', is_manual: true });
  await trx('invoice_charges').insert({ tenant, invoice_id: invoice, description: 'Eligible manual service', quantity: 1, unit_price: total, total_price: total, net_amount: total, tax_rate: 0, is_manual: true });
  active = { trx, tenant, user };
  if (availableCredit > 0) {
    const grant = await runWithTenant(tenant, () => grantCredit(client, availableCredit));
    if (!('credit_id' in grant)) throw new Error(JSON.stringify(grant));
  }
  return { tenant, client, invoice, user };
}

const getInvoice = (trx: Knex.Transaction, f: { tenant: string; invoice: string }) =>
  trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).first();

async function payFinalizedThenUnfinalize(trx: Knex.Transaction, f: Awaited<ReturnType<typeof fixture>>, amount: number) {
  await runWithTenant(f.tenant, async () => {
    await finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true });
    const paid = await recordExternalPayment(trx, f.tenant, { invoiceId: f.invoice, amount, provider: 'test', referenceNumber: `ref-${f.invoice}` });
    expect(paid).toMatchObject({ success: true, paymentRecorded: true });
    const result = await unfinalizeInvoice(f.invoice);
    expect(result).toMatchObject({ success: true });
  });
  const invoice = await getInvoice(trx, f);
  expect(invoice.status).toBe('draft');
  expect(invoice.finalized_at).toBeNull();
}

async function inTransaction(run: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await connection.transaction();
  try { await run(trx); } finally { active = undefined; await trx.rollback(); }
}

describe('finalize derives status from recorded payments', () => {
  it('T002: paid -> unfinalize -> finalize stays paid, audits paid, draws no credit', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 5000);
      await payFinalizedThenUnfinalize(trx, f, 10000);
      active = { trx, tenant: f.tenant, user: f.user };
      // Auto-apply is ON (default) and 5000 credit is available.
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, f.user.user_id));
      const invoice = await getInvoice(trx, f);
      expect(invoice.status).toBe('paid');
      expect(Number(invoice.credit_applied)).toBe(0);
      const audit = await trx('audit_logs').where({ tenant: f.tenant, record_id: f.invoice, operation: 'invoice_finalized' }).orderBy('timestamp', 'desc').first();
      expect(audit.details.after.status).toBe('paid');
      const credits = await trx('credit_tracking').where({ tenant: f.tenant, client_id: f.client }).select('remaining_amount');
      expect(credits.reduce((sum, row) => sum + Number(row.remaining_amount), 0)).toBe(5000);
      expect(await trx('credit_allocations').where({ tenant: f.tenant, invoice_id: f.invoice })).toHaveLength(0);
    });
  });

  it('T003: higher total -> partially_applied; total below the amount paid -> paid with negative balance', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000);
      await payFinalizedThenUnfinalize(trx, f, 10000);
      await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).update({ total_amount: 15000, subtotal: 15000 });
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true }));
      const invoice = await getInvoice(trx, f);
      expect(invoice.status).toBe('partially_applied');
      expect(computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: 10000 })).toBe(5000);
    });
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000);
      await payFinalizedThenUnfinalize(trx, f, 10000);
      await trx('invoices').where({ tenant: f.tenant, invoice_id: f.invoice }).update({ total_amount: 7000, subtotal: 7000 });
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true }));
      const invoice = await getInvoice(trx, f);
      expect(invoice.status).toBe('paid');
      expect(computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied ?? 0), totalPaid: 10000 })).toBe(-3000);
    });
  });

  it('T008: payment plus auto-applied credit covering the total re-finalizes as paid', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 5000);
      await payFinalizedThenUnfinalize(trx, f, 5000);
      active = { trx, tenant: f.tenant, user: f.user };
      // Finalize derives partially_applied (5000 of 10000 paid); auto-apply then draws the 5000 credit.
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, f.user.user_id));
      const invoice = await getInvoice(trx, f);
      expect(Number(invoice.credit_applied)).toBe(5000);
      expect(computeBalanceDue({ totalAmount: Number(invoice.total_amount), creditApplied: Number(invoice.credit_applied), totalPaid: 5000 })).toBe(0);
      expect(invoice.status).toBe('paid');
    });
  });

  it('T009: manual credit covering the rest of a partially paid invoice makes it paid; credit alone keeps sent', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 10000);
      await runWithTenant(f.tenant, async () => {
        await finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true });
        await recordExternalPayment(trx, f.tenant, { invoiceId: f.invoice, amount: 4000, provider: 'test', referenceNumber: `ref-${f.invoice}` });
      });
      expect((await getInvoice(trx, f)).status).toBe('partially_applied');
      await runWithTenant(f.tenant, () => applyCreditToInvoiceInternal(f.tenant, f.user, f.client, f.invoice, 2000));
      expect((await getInvoice(trx, f)).status).toBe('partially_applied');
      await runWithTenant(f.tenant, () => applyCreditToInvoiceInternal(f.tenant, f.user, f.client, f.invoice, 4000));
      expect((await getInvoice(trx, f)).status).toBe('paid');
    });
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000, 10000);
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true }));
      await runWithTenant(f.tenant, () => applyCreditToInvoiceInternal(f.tenant, f.user, f.client, f.invoice, 10000));
      // paid requires net payments > 0 (unchanged rule); a credit-only covered invoice keeps its status.
      expect((await getInvoice(trx, f)).status).toBe('sent');
    });
  });

  it('T004: a fresh invoice with no payments finalizes as sent', async () => {
    await inTransaction(async (trx) => {
      const f = await fixture(trx, 10000);
      await runWithTenant(f.tenant, () => finalizeInvoiceWithKnex(f.invoice, trx, f.tenant, null, { skipAutoApply: true }));
      expect((await getInvoice(trx, f)).status).toBe('sent');
      const audit = await trx('audit_logs').where({ tenant: f.tenant, record_id: f.invoice, operation: 'invoice_finalized' }).first();
      expect(audit.details.after.status).toBe('sent');
    });
  });
});
