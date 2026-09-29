import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import fc from 'fast-check';
import counterexample from './fixtures/financialStateCounterexample.json';
import { createWorkspaceTestDbConnection } from '../../db/test-utils/workspaceConnection';
import type { AccountingExternalChange, IUser } from '@alga-psa/types';

let connection: Knex;
let active: { trx: Knex.Transaction; tenant: string; user: IUser } | undefined;
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    if (!active) throw new Error('Financial fixture is not active');
    return action(active.user, { tenant: active.tenant }, ...args);
  },
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => {
    if (!active) throw new Error('Financial fixture is not active');
    return { knex: active.trx, tenant: active.tenant };
  },
}));
// External delivery is outside this state model. Transactions, financial
// actions, payment ingestion and mapping-ledger persistence remain real.
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: async () => {}, publishWorkflowEvent: async () => {} }));
vi.mock('../src/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: async () => {}, enqueueExternalPaymentPush: async () => {},
  enqueueCreditApplication: async () => {}, enqueueInvoiceVoid: async () => {},
}));
vi.mock('../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({ notifyInvoiceTerminalStatus: async () => {} }));

import { runWithTenant } from '@alga-psa/db';
import { finalizeInvoiceWithKnex } from '../src/actions/invoiceModification';
import { grantCredit, applyCreditToInvoiceInternal } from '../src/actions/creditActions';
import { voidInvoice } from '../src/actions/voidInvoiceActions';
import { applyExternalPaymentChange } from '../src/services/accountingSync/paymentApplier';
import { recordExternalPayment } from '../src/services/accountingSync/recordExternalPayment';
import { SyncMappingLedger } from '../src/services/accountingSync/syncMappingLedger';
import { emptyCycleStats } from '../src/services/accountingSync/accountingSync.types';

const operations = ['finalize', 'pay', 'replay', 'reverse', 'credit', 'void', 'foreign'] as const;
type Step = { operation: typeof operations[number]; actor: number; amount: number };
type Account = {
  tenant: string; client: string; invoice: string; user: IUser;
  total: number; credit: number; available: number; paid: number;
  status: string; finalized: boolean; paymentRows: number; applications: number;
  lastPayment?: { change: AccountingExternalChange; amount: number; reversed: boolean };
};

beforeAll(() => { connection = createWorkspaceTestDbConnection(); });
afterAll(async () => { await connection?.destroy(); });

async function account(trx: Knex.Transaction, total: number): Promise<Account> {
  const tenant = randomUUID(), client = randomUUID(), invoice = randomUUID(), userId = randomUUID();
  const user = { tenant, user_id: userId, username: userId, email: `${userId}@example.invalid`, hashed_password: 'synthetic', user_type: 'internal', is_inactive: false } as IUser;
  await trx('tenants').insert({ tenant, client_name: 'Financial model', email: `${tenant}@example.invalid` });
  await trx('clients').insert({ tenant, client_id: client, client_name: 'Financial model client', default_currency_code: 'USD' });
  await trx('users').insert(user);
  await trx('invoices').insert({ tenant, invoice_id: invoice, client_id: client, invoice_number: `MODEL-${invoice}`, invoice_date: '2026-09-01', due_date: '2026-10-01', total_amount: total, subtotal: total, tax: 0, credit_applied: 0, status: 'draft', currency_code: 'USD', tax_source: 'internal', is_manual: true });
  await trx('invoice_charges').insert({ tenant, invoice_id: invoice, description: 'Eligible manual service', quantity: 1, unit_price: total, total_price: total, net_amount: total, tax_rate: 0, is_manual: true });
  await new SyncMappingLedger(trx, tenant, 'quickbooks_online').insert({ algaEntityType: 'invoice', algaEntityId: invoice, externalEntityId: 'invoice-model', targetRealm: 'model-realm', syncStatus: 'synced' });
  active = { trx, tenant, user };
  const grant = await runWithTenant(tenant, () => grantCredit(client, total));
  if (!('credit_id' in grant)) throw new Error(JSON.stringify(grant));
  return { tenant, client, invoice, user, total, credit: 0, available: total, paid: 0, status: 'draft', finalized: false, paymentRows: 0, applications: 0 };
}

async function observe(trx: Knex.Transaction, model: Account) {
  const scope = (table: string) => trx(table).where({ tenant: model.tenant });
  const invoice = await scope('invoices').where({ invoice_id: model.invoice }).first();
  const payments = await scope('invoice_payments').where({ invoice_id: model.invoice }).select('amount');
  const credits = await scope('credit_tracking').where({ client_id: model.client }).select('remaining_amount');
  const allocations = await scope('credit_allocations').where({ invoice_id: model.invoice }).select('allocation_id');
  const paymentTransactions = await scope('transactions').where({ invoice_id: model.invoice }).whereIn('type', ['payment', 'payment_reversal']).select('amount');
  const paid = payments.reduce((sum, row) => sum + Number(row.amount), 0);
  expect(Number(invoice.total_amount)).toBe(model.total);
  expect(Number(invoice.credit_applied)).toBe(model.credit);
  expect(credits.reduce((sum, row) => sum + Number(row.remaining_amount), 0)).toBe(model.available);
  expect(model.available + model.credit).toBe(model.total);
  expect(paid).toBe(model.paid);
  expect(paymentTransactions.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(model.paid);
  expect(payments).toHaveLength(model.paymentRows);
  expect(paymentTransactions).toHaveLength(model.paymentRows);
  expect(allocations).toHaveLength(model.applications);
  expect(invoice.status).toBe(model.status);
  expect(Boolean(invoice.finalized_at)).toBe(model.finalized);
  expect(model.total - paid - Number(invoice.credit_applied)).toBeGreaterThanOrEqual(0);
}

async function execute(trx: Knex.Transaction, models: Account[], step: Step) {
  const m = models[step.actor];
  active = { trx, tenant: m.tenant, user: m.user };
  const ledger = new SyncMappingLedger(trx, m.tenant, 'quickbooks_online');
  const applyPayment = (change: AccountingExternalChange) => applyExternalPaymentChange({
    knex: trx, tenantId: m.tenant, adapterType: 'quickbooks_online', targetRealm: 'model-realm', ledger,
    stats: emptyCycleStats(), exceptions: { createOrUpdate: async input => { throw new Error(`Unexpected sync exception: ${JSON.stringify(input)}`); }, resolve: async () => {} },
  }, change);
  await runWithTenant(m.tenant, async () => {
    switch (step.operation) {
      case 'finalize':
        if (!m.finalized) {
          await finalizeInvoiceWithKnex(m.invoice, trx, m.tenant, null, { skipAutoApply: true });
          m.finalized = true; m.status = 'sent';
        } else {
          await expect(finalizeInvoiceWithKnex(m.invoice, trx, m.tenant, null, { skipAutoApply: true })).rejects.toThrow(/already finalized/i);
        }
        break;
      case 'pay': {
        const due = m.total - m.credit - m.paid;
        // Reverse the current external payment before creating another one.
        if (!m.finalized || m.status === 'cancelled' || due <= 0 || (m.lastPayment && !m.lastPayment.reversed)) break;
        const amount = Math.min(step.amount, due);
        const change: AccountingExternalChange = { entityType: 'Payment', externalId: randomUUID(), deleted: false, syncToken: '1', payload: { TxnDate: '2026-09-01', TotalAmt: amount / 100, CurrencyRef: { value: 'USD' }, Line: [{ Amount: amount / 100, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'invoice-model' }] }] } };
        await applyPayment(change);
        m.lastPayment = { change, amount, reversed: false }; m.paid += amount; m.paymentRows++;
        m.status = m.paid + m.credit === m.total ? 'paid' : 'partially_applied';
        break;
      }
      case 'replay':
        if (m.lastPayment) await applyPayment(m.lastPayment.change);
        break;
      case 'reverse':
        if (m.lastPayment && !m.lastPayment.reversed) {
          const change = { ...m.lastPayment.change, deleted: true, syncToken: '2' };
          await applyPayment(change);
          m.paid -= m.lastPayment.amount; m.paymentRows++; m.lastPayment = { ...m.lastPayment, change, reversed: true };
          m.status = 'sent';
        }
        break;
      case 'credit': {
        if (!m.finalized || m.status === 'cancelled') break;
        const expected = Math.min(step.amount, m.available, m.total - m.credit - m.paid);
        const result = await applyCreditToInvoiceInternal(m.tenant, m.user, m.client, m.invoice, step.amount);
        expect(result.appliedAmount).toBe(expected);
        m.credit += expected; m.available -= expected; if (expected > 0) m.applications++;
        break;
      }
      case 'void':
        if (!m.finalized || m.status === 'cancelled' || m.paid > 0) {
          expect((await voidInvoice(m.invoice, 'Model void')).success).toBe(false);
        } else {
          expect(await voidInvoice(m.invoice, 'Model void')).toEqual({ success: true });
          m.available += m.credit; m.credit = 0; m.status = 'cancelled';
        }
        break;
      case 'foreign': {
        const other = models[1 - step.actor];
        const result = await recordExternalPayment(trx, m.tenant, { invoiceId: other.invoice, amount: step.amount, provider: 'model', referenceNumber: 'wrong-tenant' });
        expect(result).toMatchObject({ success: false, paymentRecorded: false });
        break;
      }
    }
  });
  // Check both tenants after every operation, including rejected and replayed work.
  for (const model of models) await observe(trx, model);
}

async function sequence(total: number, steps: Step[]) {
  const trx = await connection.transaction();
  try {
    const models = [await account(trx, total), await account(trx, total + 100)];
    for (const step of steps) await execute(trx, models, step);
  } finally {
    active = undefined;
    await trx.rollback();
  }
}

const step = (operation: Step['operation'], amount = 5000, actor = 0): Step => ({ operation, amount, actor });
describe('Independent financial state model', () => {
  it('does not apply credit to an amount already paid', async () => {
    await sequence(10000, [step('finalize'), step('pay', 6000), step('credit', 10000)]);
  });

  it('conserves credit and cash across finalization, delivery retries, reversal and repeated void', async () => {
    await sequence(10000, [step('void'), step('finalize'), step('finalize'), step('credit', 2000), step('pay', 3000), step('replay'), step('void'), step('reverse'), step('replay'), step('void'), step('void'), step('foreign')]);
  });

  it('replays the saved shrunk payment-credit counterexample', async () => {
    await sequence(counterexample.total, [step('finalize', 1, 0), step('finalize', 1, 1), ...counterexample.steps as Step[]]);
  });

  it('checks generated two-tenant operation sequences and reports shrunk replay seeds', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 100, max: 50000 }),
      fc.array(fc.record({ operation: fc.constantFrom(...operations), actor: fc.integer({ min: 0, max: 1 }), amount: fc.integer({ min: 1, max: 60000 }) }), { minLength: 1, maxLength: 25 }),
      async (total, steps) => sequence(total, [step('finalize', 1, 0), step('finalize', 1, 1), ...steps]),
    ), { seed: Number(process.env.FINANCIAL_MODEL_SEED ?? 20260906), numRuns: 100, verbose: true, ...(process.env.FINANCIAL_MODEL_PATH ? { path: process.env.FINANCIAL_MODEL_PATH } : {}) });
  }, 120000);
});
