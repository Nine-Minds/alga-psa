import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';

const state = vi.hoisted(() => ({
  db: null as any,
  tenant: '',
  contactId: '',
  getOrCreateInvoicePaymentLinkUrl: vi.fn(async () => 'https://checkout.test/session'),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) =>
    action({ user_id: 'portal-user', contact_id: state.contactId }, { tenant: state.tenant }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, createTenantKnex: async () => ({ knex: state.db }) };
});

vi.mock('@alga-psa/billing/actions/paymentActions', () => ({
  getActiveInvoicePaymentLinkUrl: vi.fn(),
  getInvoicePaymentStatus: vi.fn(),
  getOrCreateInvoicePaymentLinkUrl: state.getOrCreateInvoicePaymentLinkUrl,
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
}));

import { getClientPortalInvoicePaymentLink } from '../../../../../packages/client-portal/src/actions/clientPaymentActions';

const helpers = TestContext.createHelpers();

describe('client portal payment link amount due nets payments', () => {
  const HOOK_TIMEOUT = 240_000;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['invoice_payments', 'invoices', 'contacts'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    state.db = ctx.db;
    state.tenant = ctx.tenantId;
    state.contactId = uuidv4();
    state.getOrCreateInvoicePaymentLinkUrl.mockClear();
    await ctx.db('invoice_payments').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('contacts').insert({
      tenant: ctx.tenantId,
      contact_name_id: state.contactId,
      client_id: ctx.clientId,
      full_name: 'Portal Payer',
      email: `portal-${state.contactId.slice(0, 8)}@example.com`,
      is_inactive: false,
    });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seed(total: number, credit: number, payments: number[]): Promise<string> {
    const invoiceId = uuidv4();
    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: `INV-PORTAL-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-01-15',
      due_date: '2026-02-15',
      subtotal: total,
      tax: 0,
      total_amount: total,
      credit_applied: credit,
      status: 'sent',
      finalized_at: new Date('2026-01-15T00:00:00Z'),
      currency_code: 'USD',
      is_manual: false,
    });
    for (const amount of payments) {
      await ctx.db('invoice_payments').insert({
        payment_id: uuidv4(),
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        amount,
        payment_method: 'stripe',
        status: 'completed',
      });
    }
    return invoiceId;
  }

  it('partial payment still offers checkout', async () => {
    const id = await seed(100000, 0, [1000]);
    expect(await getClientPortalInvoicePaymentLink(id)).toMatchObject({ success: true });
  }, HOOK_TIMEOUT);

  it('credit plus payment leaving a balance still offers checkout', async () => {
    const id = await seed(100000, 20000, [30000]);
    expect(await getClientPortalInvoicePaymentLink(id)).toMatchObject({ success: true });
  }, HOOK_TIMEOUT);

  it('full payment reports no_amount_due', async () => {
    const id = await seed(100000, 0, [100000]);
    expect(await getClientPortalInvoicePaymentLink(id)).toMatchObject({
      success: false,
      error: { code: 'no_amount_due' },
    });
    expect(state.getOrCreateInvoicePaymentLinkUrl).not.toHaveBeenCalled();
  }, HOOK_TIMEOUT);

  it('credit plus payment covering the total reports no_amount_due', async () => {
    const id = await seed(100000, 40000, [60000]);
    expect(await getClientPortalInvoicePaymentLink(id)).toMatchObject({
      success: false,
      error: { code: 'no_amount_due' },
    });
  }, HOOK_TIMEOUT);

  it('no payments is unchanged (regression guard)', async () => {
    const id = await seed(100000, 0, []);
    expect(await getClientPortalInvoicePaymentLink(id)).toMatchObject({ success: true });
  }, HOOK_TIMEOUT);
});
