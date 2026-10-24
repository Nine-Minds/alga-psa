import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import { createTestService, ensureDefaultBillingSettings } from '../../../../test-utils/billingTestHelpers';
import { createBillingProfile, ensureDefaultBillingProfile } from '../../../../test-utils/billingProfileTestHelpers';

// Invoice creation publishes events; the bus is not under test.
vi.mock('../../../lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// Generic create() numbers invoices through the withAuth-wrapped action.
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { InvoiceService } from '@/lib/api/services/InvoiceService';
import { manualInvoiceRequestSchema } from '@/lib/api/schemas/invoiceSchemas';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

describe('REST manual invoice creation takes terms from the effective billing identity', () => {
  let context: TestContext;
  let serviceId: string;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings(context);
    serviceId = await createTestService(context, {
      billing_method: 'fixed',
      default_rate: 5000,
      service_name: 'Manual REST service',
    });
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  function serviceUnderTest() {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    return service;
  }

  async function create(extra: Record<string, unknown> = {}) {
    const request = manualInvoiceRequestSchema.parse({
      clientId: context.clientId,
      items: [{ service_id: serviceId, quantity: 1, description: 'Work', rate: 5000 }],
      ...extra,
    });
    const created = await serviceUnderTest().generateManualInvoice(request, {
      tenant: context.tenantId,
      userId: context.userId,
    } as any);
    return context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id })
      .first();
  }

  const dateOnly = (v: Date | string) => (v instanceof Date ? v.toISOString() : v).slice(0, 10);
  const daysBetween = (a: Date | string, b: Date | string) =>
    Math.round((Date.parse(dateOnly(b)) - Date.parse(dateOnly(a))) / 86400000);

  it('uses client terms and preferred method, and records the default profile', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ payment_terms: 'net_15', preferred_payment_method: 'credit_card' });
    const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);

    const header = await create();

    expect(daysBetween(header.invoice_date, header.due_date)).toBe(15);
    expect(header.payment_method).toBe('credit_card');
    expect(header.billing_profile_id).toBe(defaultProfileId);
  });

  it('lets the default profile override the client terms and method', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ payment_terms: 'net_15', preferred_payment_method: 'credit_card' });
    const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);
    await context.db('client_billing_profiles')
      .where({ tenant: context.tenantId, billing_profile_id: defaultProfileId })
      .update({ payment_terms: 'due_on_receipt', preferred_payment_method: 'bank_transfer' });

    const header = await create();

    expect(daysBetween(header.invoice_date, header.due_date)).toBe(0);
    expect(header.payment_method).toBe('bank_transfer');
    expect(header.billing_profile_id).toBe(defaultProfileId);
  });

  it('honors an explicit billingProfileId belonging to the client', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ payment_terms: 'net_15', preferred_payment_method: 'credit_card' });
    const otherProfileId = await createBillingProfile(context, context.clientId, 'North Plant');
    await context.db('client_billing_profiles')
      .where({ tenant: context.tenantId, billing_profile_id: otherProfileId })
      .update({ payment_terms: 'net_30', preferred_payment_method: 'check' });

    const header = await create({ billingProfileId: otherProfileId });

    expect(daysBetween(header.invoice_date, header.due_date)).toBe(30);
    expect(header.payment_method).toBe('check');
    expect(header.billing_profile_id).toBe(otherProfileId);
  });

  it('bills the charges under the explicit billingProfileId, not the client default', async () => {
    const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);
    const otherProfileId = await createBillingProfile(context, context.clientId, 'South Plant');
    expect(otherProfileId).not.toBe(defaultProfileId);

    const header = await create({ billingProfileId: otherProfileId });
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: header.invoice_id })
      .select('billing_profile_id');

    expect(header.billing_profile_id).toBe(otherProfileId);
    expect(charges.length).toBeGreaterThan(0);
    for (const charge of charges) {
      expect(charge.billing_profile_id).toBe(header.billing_profile_id);
    }
  });

  it('bills the charges under the header profile when billingProfileId is omitted', async () => {
    const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);

    const header = await create();
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: header.invoice_id })
      .select('billing_profile_id');

    expect(header.billing_profile_id).toBe(defaultProfileId);
    expect(charges.length).toBeGreaterThan(0);
    for (const charge of charges) {
      expect(charge.billing_profile_id).toBe(defaultProfileId);
    }
  });

  it('rejects a billingProfileId that belongs to another client with a 400', async () => {
    const { v4: uuidv4 } = await import('uuid');
    const otherClientId = uuidv4();
    await context.db('clients').insert({
      tenant: context.tenantId,
      client_id: otherClientId,
      client_name: 'Other client',
    });
    const foreignProfileId = await createBillingProfile(context, otherClientId, 'Foreign');

    const before = await context.db('invoices').where({ tenant: context.tenantId }).count('* as n').first();
    await expect(create({ billingProfileId: foreignProfileId })).rejects.toMatchObject({
      statusCode: 400,
      details: expect.objectContaining({ code: 'BILLING_PROFILE_NOT_FOUND' }),
    });
    const after = await context.db('invoices').where({ tenant: context.tenantId }).count('* as n').first();
    expect(after?.n).toEqual(before?.n);
  });

  describe('update guards', () => {
    async function updateAs(id: string, data: Record<string, unknown>) {
      return serviceUnderTest().update(id, data as any, {
        tenant: context.tenantId,
        userId: context.userId,
      } as any);
    }

    it('allows payment_method changes on a draft', async () => {
      const header = await create();
      await updateAs(header.invoice_id, { payment_method: 'check' });
      const row = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: header.invoice_id }).first();
      expect(row.payment_method).toBe('check');
    });

    it('rejects payment_method changes on a non-draft invoice with a 409 ConflictError', async () => {
      const header = await create();
      await context.db('invoices')
        .where({ tenant: context.tenantId, invoice_id: header.invoice_id })
        .update({ status: 'sent' });
      await expect(updateAs(header.invoice_id, { payment_method: 'check' })).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('rejects a billing_profile_id change once a payment is recorded', async () => {
      const header = await create();
      const otherProfileId = await createBillingProfile(context, context.clientId, 'Second');
      await context.db('invoice_payments').insert({
        tenant: context.tenantId,
        invoice_id: header.invoice_id,
        amount: 100,
        payment_method: 'check',
        payment_date: new Date().toISOString(),
      });
      await expect(updateAs(header.invoice_id, { billing_profile_id: otherProfileId })).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('allows a billing_profile_id change while no payments exist', async () => {
      const header = await create();
      const otherProfileId = await createBillingProfile(context, context.clientId, 'Second');
      await updateAs(header.invoice_id, { billing_profile_id: otherProfileId });
      const row = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: header.invoice_id }).first();
      expect(row.billing_profile_id).toBe(otherProfileId);
    });
  });

  describe('generic create/update profile ownership and terms', () => {
    async function foreignProfile() {
      const { v4: uuidv4 } = await import('uuid');
      const otherClientId = uuidv4();
      await context.db('clients').insert({
        tenant: context.tenantId,
        client_id: otherClientId,
        client_name: 'Other client',
      });
      return createBillingProfile(context, otherClientId, 'Foreign');
    }

    const ctx = () => ({ tenant: context.tenantId, userId: context.userId } as any);
    const base = () => ({
      client_id: context.clientId,
      invoice_date: '2026-03-01',
      subtotal: 0,
      tax: 0,
      total_amount: 0,
      status: 'draft',
    });

    it('rejects a foreign billing_profile_id on generic create', async () => {
      const foreignId = await foreignProfile();
      await expect(
        serviceUnderTest().create({ ...base(), due_date: '2026-03-31', billing_profile_id: foreignId } as any, ctx()),
      ).rejects.toMatchObject({ statusCode: 400, details: expect.objectContaining({ code: 'BILLING_PROFILE_NOT_FOUND' }) });
    });

    it('rejects an inactive billing_profile_id on generic create', async () => {
      const profileId = await createBillingProfile(context, context.clientId, 'Inactive');
      await context.db('client_billing_profiles')
        .where({ tenant: context.tenantId, billing_profile_id: profileId })
        .update({ is_active: false });
      await expect(
        serviceUnderTest().create({ ...base(), due_date: '2026-03-31', billing_profile_id: profileId } as any, ctx()),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a foreign billing_profile_id on update', async () => {
      const header = await create();
      const foreignId = await foreignProfile();
      await expect(updateAsGeneric(header.invoice_id, { billing_profile_id: foreignId })).rejects.toMatchObject({
        statusCode: 400,
        details: expect.objectContaining({ code: 'BILLING_PROFILE_NOT_FOUND' }),
      });
    });

    function updateAsGeneric(id: string, data: Record<string, unknown>) {
      return serviceUnderTest().update(id, data as any, ctx());
    }

    it('fills profile, method and due_date from the identity when create omits them', async () => {
      await context.db('clients')
        .where({ tenant: context.tenantId, client_id: context.clientId })
        .update({ payment_terms: 'net_15', preferred_payment_method: 'credit_card' });
      const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);

      const created = await serviceUnderTest().create(base() as any, ctx());
      const row = await context.db('invoices')
        .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id }).first();

      expect(row.billing_profile_id).toBe(defaultProfileId);
      expect(row.payment_method).toBe('credit_card');
      expect(daysBetween(row.invoice_date, row.due_date)).toBe(15);
    });

    it('explicit caller values win over the resolved terms', async () => {
      await context.db('clients')
        .where({ tenant: context.tenantId, client_id: context.clientId })
        .update({ payment_terms: 'net_15', preferred_payment_method: 'credit_card' });
      const profileId = await createBillingProfile(context, context.clientId, 'Explicit');

      const created = await serviceUnderTest().create(
        { ...base(), due_date: '2026-05-01', payment_method: 'check', billing_profile_id: profileId } as any,
        ctx(),
      );
      const row = await context.db('invoices')
        .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id }).first();

      expect(row.billing_profile_id).toBe(profileId);
      expect(row.payment_method).toBe('check');
      expect(dateOnly(row.due_date)).toBe('2026-05-01');
    });

    it('accepts an unchanged payment_method echoed onto a non-draft invoice', async () => {
      await context.db('clients')
        .where({ tenant: context.tenantId, client_id: context.clientId })
        .update({ preferred_payment_method: 'credit_card' });
      const header = await create();
      await context.db('invoices')
        .where({ tenant: context.tenantId, invoice_id: header.invoice_id })
        .update({ status: 'sent' });
      await expect(
        updateAsGeneric(header.invoice_id, { payment_method: 'credit_card' }),
      ).resolves.toBeDefined();
    });
  });
});
