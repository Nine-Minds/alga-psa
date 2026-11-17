/**
 * The invoice screen view model takes its tenant party from fetchTenantParty
 * (Settings > Branding logo first), the same rule the PDF path uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  orderByRaw: [] as string[],
  clientLogo: null as string | null,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: vi.fn((name: string) => {
      const query: any = {};
      for (const m of ['select', 'where', 'whereNull', 'andWhere']) query[m] = vi.fn(() => query);
      query.orderByRaw = vi.fn((sql: string) => { state.orderByRaw.push(sql); return query; });
      query.first = vi.fn(async () => state.rows[name.split(' ')[0]]);
      query.then = (resolve: any, reject: any) => Promise.resolve(state.rows[`${name}:all`] ?? []).then(resolve, reject);
      return query;
    }),
    tenantJoin: vi.fn(),
  })),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientDocumentLogoUrl: vi.fn(async (clientId: string) => (clientId === 'tenant-client' ? state.clientLogo : null)),
}));

import Invoice from '../src/models/invoice';

const knex: any = { raw: vi.fn((v: string) => v) };

describe('Invoice.getFullInvoiceById tenant party', () => {
  beforeEach(() => {
    state.orderByRaw = [];
    state.clientLogo = null;
    state.rows = {
      invoices: { invoice_id: 'inv-1', client_id: 'client-1', invoice_number: 'INV-1', total_amount: 0, subtotal: 0, tax: 0, credit_applied: 0 },
      clients: { client_name: 'Customer', properties: {} },
      contacts: undefined,
      tenant_companies: { client_id: 'tenant-client', client_name: 'Managed Nerds', address_line1: '1 Billing Way', city: 'Seattle' },
      tenant_settings: { settings: { branding: { logoUrl: '/api/documents/view/branding-logo' } } },
    };
    vi.spyOn(Invoice, 'getInvoiceCharges').mockResolvedValue([]);
  });

  it('carries the Branding logo for a tenant with no client logo document', async () => {
    const view = await Invoice.getFullInvoiceById(knex, 'tenant-1', 'inv-1');
    expect(view.tenantClient).toEqual({
      name: 'Managed Nerds',
      address: expect.stringContaining('1 Billing Way'),
      logoUrl: '/api/documents/view/branding-logo',
    });
  });

  it('falls back to the tenant client logo document when no branding logo is configured', async () => {
    state.rows.tenant_settings = undefined;
    state.clientLogo = '/api/documents/view/client-doc';
    const view = await Invoice.getFullInvoiceById(knex, 'tenant-1', 'inv-1');
    expect(view.tenantClient?.logoUrl).toBe('/api/documents/view/client-doc');
  });

  it('orders the tenant address billing-address-first', async () => {
    await Invoice.getFullInvoiceById(knex, 'tenant-1', 'inv-1');
    expect(state.orderByRaw).toContain('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST');
  });
});

describe('adaptToWasmViewModel (pre-generation preview) tenant party', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../src/actions/invoiceGeneration.ts'),
    'utf8',
  );
  const start = source.indexOf('async function adaptToWasmViewModel(');
  const body = source.slice(start, source.indexOf('const previewViewModel', start));

  it('takes name, address and logo from fetchTenantParty, so the billing address wins over the default location', () => {
    expect(body).toContain('await fetchTenantParty(knex, tenant)');
    expect(body).toContain('address: tenantParty.address');
    expect(body).toContain('logoUrl: tenantParty.logo_url');
  });

  it('no longer runs its own tenant_companies / client_locations lookup or logo rule', () => {
    expect(body).not.toContain('tenant_companies');
    expect(body).not.toContain('client_locations');
    expect(body).not.toContain('getClientDocumentLogoUrl');
    expect(body).not.toContain('address_line1');
  });
});
