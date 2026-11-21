import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TestContext } from '../../../../test-utils/testContext';
import { ensureDefaultBillingSettings } from '../../../../test-utils/billingTestHelpers';

const sessionAuth = vi.hoisted(() => ({ resolve: vi.fn(async () => null) }));

// The global server test setup installs a permissive @alga-psa/auth facade
// whose withAuth supplies a fallback user. This suite exercises the production
// wrapper and API-key AsyncLocalStorage so numbering cannot pass via that user.
vi.unmock('@alga-psa/auth');
vi.mock('../../../../../packages/auth/src/lib/getSession', () => ({
  getSession: sessionAuth.resolve,
  getSessionWithRevocationCheck: sessionAuth.resolve,
  logSessionRejection: vi.fn(async () => undefined),
}));

const identity = vi.hoisted(() => ({
  tenant: '',
  userId: '',
  permissions: new Set<string>(),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async (key: string) => key === 'authorized-key' || key === 'read-only-key'
      ? { user_id: identity.userId, tenant: identity.tenant, api_key_id: 'api-key-id' }
      : null),
    validateApiKeyForTenant: vi.fn(async (key: string) => key === 'authorized-key' || key === 'read-only-key'
      ? { user_id: identity.userId, tenant: identity.tenant, api_key_id: 'api-key-id' }
      : null),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async (userId: string, tenant: string) => ({
    user_id: userId, tenant, user_type: 'internal', roles: [],
  })),
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    user.user_id === identity.userId && resource === 'invoice' && identity.permissions.has(action)),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    user.user_id === identity.userId && resource === 'invoice' && identity.permissions.has(action)),
}));
vi.mock('../../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: async () => 'psa' }));

import { runWithApiKeyUser } from '@alga-psa/auth';
import { runWithTenant } from '@alga-psa/db';
import { InvoiceService } from '@/lib/api/services/InvoiceService';
import { POST } from '@/app/api/v1/invoices/[id]/duplicate/route';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

describe('POST /api/v1/invoices/{id}/duplicate with API-key identity', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    identity.tenant = context.tenantId;
    identity.userId = context.userId;
    identity.permissions = new Set(['create', 'read']);
    await ensureDefaultBillingSettings(context);
    vi.spyOn(InvoiceService.prototype as any, 'getKnex')
      .mockResolvedValue({ knex: context.db, tenant: context.tenantId });
  }, 30000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  const serviceContext = () => ({
    tenant: context.tenantId,
    userId: context.userId,
    user: { user_id: context.userId, tenant: context.tenantId, user_type: 'internal', roles: [] },
  } as any);

  async function sourceInvoice() {
    // Use the same real API-key identity store as the controller. This creates an
    // invoice with the real withAuth-wrapped number generator and leaves the store
    // empty before the HTTP request under test.
    return runWithApiKeyUser(serviceContext().user, () => runWithTenant(context.tenantId, () => new InvoiceService().create({
      client_id: context.clientId,
      invoice_date: '2026-03-01',
      due_date: '2026-03-31',
      items: [{ description: 'API key duplicate source', quantity: 2, unit_price: 1250 }],
    } as any, serviceContext())));
  }

  function duplicate(invoiceId: string, key: string) {
    const request = new NextRequest(`http://localhost/api/v1/invoices/${invoiceId}/duplicate`, {
      method: 'POST',
      headers: { 'x-api-key': key },
    });
    (request as any).params = Promise.resolve({ id: invoiceId });
    return POST(request as any, { params: Promise.resolve({ id: invoiceId }) });
  }

  it('creates a calculated manual draft with no session cookie for an authorized key', async () => {
    const source = await sourceInvoice();
    const response = await duplicate(source.invoice_id, 'authorized-key');

    expect(response.status).toBe(201);
    expect(sessionAuth.resolve).not.toHaveBeenCalled();
    const { data } = await response.json();
    const header = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: data.invoice_id }).first();
    const sourceHeader = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: source.invoice_id }).first();
    const charges = await context.db('invoice_charges').where({ tenant: context.tenantId, invoice_id: data.invoice_id });
    const subtotal = charges.reduce((sum: number, charge: any) => sum + Number(charge.net_amount), 0);
    const tax = charges.reduce((sum: number, charge: any) => sum + Number(charge.tax_amount), 0);

    expect(header.invoice_id).not.toBe(source.invoice_id);
    expect(header.invoice_number).not.toBe(sourceHeader.invoice_number);
    expect(header.status).toBe('draft');
    expect(header.is_manual).toBe(true);
    expect(Number(header.credit_applied)).toBe(0);
    expect(charges).toHaveLength(1);
    expect(Number(header.subtotal)).toBe(Math.round(subtotal));
    expect(Number(header.tax)).toBe(Math.round(tax));
    expect(Number(header.total_amount)).toBe(Math.round(subtotal + tax));
  });

  it('keeps invoice:create enforcement for a key without that permission', async () => {
    const source = await sourceInvoice();
    identity.permissions = new Set(['read']);
    const before = await context.db('invoices').where({ tenant: context.tenantId }).count('* as count').first();

    const response = await duplicate(source.invoice_id, 'read-only-key');

    expect(response.status).toBe(403);
    const after = await context.db('invoices').where({ tenant: context.tenantId }).count('* as count').first();
    expect(Number(after?.count)).toBe(Number(before?.count));
  });
});
