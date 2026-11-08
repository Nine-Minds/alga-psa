import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();

describe('InvoiceService include_client billing address is per client', () => {
  const HOOK_TIMEOUT = 240_000;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['client_locations', 'invoices'],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedClient(name: string): Promise<string> {
    const clientId = uuidv4();
    await ctx.db('clients').insert({
      tenant: ctx.tenantId,
      client_id: clientId,
      client_name: name,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: ctx.db.fn.now(),
      updated_at: ctx.db.fn.now(),
    });
    return clientId;
  }

  async function seedLocation(clientId: string, street: string, flags: { billing?: boolean; def?: boolean }) {
    await ctx.db('client_locations').insert({
      tenant: ctx.tenantId,
      location_id: uuidv4(),
      client_id: clientId,
      location_name: street,
      address_line1: street,
      city: 'Springfield',
      country_code: 'US',
      country_name: 'United States',
      is_default: !!flags.def,
      is_billing_address: !!flags.billing,
      is_shipping_address: false,
      is_active: true,
    });
  }

  async function seedInvoice(clientId: string): Promise<string> {
    const invoiceId = uuidv4();
    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: clientId,
      invoice_number: `INV-ADDR-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-01-15',
      due_date: '2026-02-15',
      subtotal: 100,
      tax: 0,
      total_amount: 100,
      credit_applied: 0,
      status: 'sent',
      currency_code: 'USD',
      is_manual: false,
    });
    return invoiceId;
  }

  it('gives every client its own billing address, falling back to default', async () => {
    const clientA = await seedClient('Addr A');
    const clientB = await seedClient('Addr B');
    const clientC = await seedClient('Addr C');
    // A and B: a non-billing default plus a billing location (billing must win).
    await seedLocation(clientA, '1 Alpha Way', { billing: true });
    await seedLocation(clientA, '99 Alpha Default', { def: true });
    await seedLocation(clientB, '2 Beta Road', { billing: true });
    // C: only a default location.
    await seedLocation(clientC, '3 Gamma Lane', { def: true });
    const invA = await seedInvoice(clientA);
    const invB = await seedInvoice(clientB);
    const invC = await seedInvoice(clientC);

    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: ctx.db });

    const list = await service.list(
      { page: 1, limit: 50, include_client: true } as any,
      { tenant: ctx.tenantId, userId: ctx.userId } as any,
      {} as any,
    );
    const byId = new Map(list.data.map((row: any) => [row.invoice_id, row]));

    expect((byId.get(invA) as any).billing_address).toContain('1 Alpha Way');
    expect((byId.get(invA) as any).billing_address).not.toContain('99 Alpha Default');
    expect((byId.get(invB) as any).billing_address).toContain('2 Beta Road');
    expect((byId.get(invC) as any).billing_address).toContain('3 Gamma Lane');
    expect(list.data.filter((row: any) => [invA, invB, invC].includes(row.invoice_id))).toHaveLength(3);
  }, HOOK_TIMEOUT);
});
