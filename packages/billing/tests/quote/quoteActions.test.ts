import { beforeEach, describe, expect, it, vi } from 'vitest';
import Quote from '../../src/models/quote';
import QuoteItem from '../../src/models/quoteItem';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '44444444-4444-4444-8444-444444444444';
const QUOTE_ITEM_ID = '55555555-5555-4555-8555-555555555555';

const currentUser = {
  id: USER_ID,
  user_id: USER_ID,
  tenant: TENANT_ID,
  roles: [],
};

const mockTrx = { scope: 'trx' };
const mockKnex = {
  transaction: async (handler: (trx: typeof mockTrx) => Promise<unknown>) => handler(mockTrx),
};
const createTenantKnex = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn(currentUser, { tenant: TENANT_ID }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

const baseQuoteInput = {
  client_id: '66666666-6666-4666-8666-666666666666',
  title: 'Managed Services Proposal',
  quote_date: '2026-03-13T00:00:00.000Z',
  valid_until: '2026-03-20T00:00:00.000Z',
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  currency_code: 'USD',
  is_template: false,
};

const baseItemInput = {
  quote_id: QUOTE_ID,
  description: 'Endpoint monitoring',
  quantity: 2,
  unit_price: 1500,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  is_taxable: true,
};

const templateQuote = {
  quote_id: '77777777-7777-4777-8777-777777777777',
  quote_number: null,
  title: 'Template quote',
  description: 'Template description',
  internal_notes: 'Internal template note',
  client_notes: 'Template note',
  terms_and_conditions: 'Template terms',
  currency_code: 'USD',
  is_template: true,
  quote_items: [
    {
      quote_item_id: '88888888-8888-4888-8888-888888888888',
      quote_id: '77777777-7777-4777-8777-777777777777',
      service_id: SERVICE_ID,
      description: 'Managed Endpoint',
      quantity: 3,
      unit_price: 1200,
      total_price: 3600,
      net_amount: 3600,
      tax_amount: 0,
      display_order: 0,
      is_optional: true,
      is_selected: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      is_taxable: true,
      billing_method: 'fixed',
    },
    {
      quote_item_id: '99999999-9999-4999-8999-999999999999',
      quote_id: '77777777-7777-4777-8777-777777777777',
      service_id: null,
      description: 'Onboarding',
      quantity: 1,
      unit_price: 5000,
      total_price: 5000,
      net_amount: 5000,
      tax_amount: 0,
      display_order: 1,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      billing_frequency: null,
      is_taxable: true,
      billing_method: 'fixed',
    },
  ],
};

describe('quoteActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    createTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: TENANT_ID });
    hasPermissionMock.mockResolvedValue(true);
    vi.spyOn(Quote, 'create').mockResolvedValue({ quote_id: QUOTE_ID } as any);
    vi.spyOn(Quote, 'update').mockResolvedValue({ quote_id: QUOTE_ID } as any);
    vi.spyOn(Quote, 'getById').mockResolvedValue({ quote_id: QUOTE_ID, quote_number: 'Q-0001' } as any);
    vi.spyOn(Quote, 'listByTenant').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 1 } as any);
    vi.spyOn(Quote, 'delete').mockResolvedValue(undefined as any);
    vi.spyOn(QuoteItem, 'create').mockImplementation(async (_knex, _tenant, input) => ({
      quote_item_id: QUOTE_ITEM_ID,
      ...input,
      total_price: Number(input.quantity) * Number(input.unit_price),
      net_amount: Number(input.quantity) * Number(input.unit_price),
      tax_amount: 0,
      display_order: input.display_order ?? 0,
    }) as any);
    vi.spyOn(QuoteItem, 'update').mockImplementation(async (_knex, _tenant, quoteItemId, input) => ({
      quote_item_id: quoteItemId,
      ...baseItemInput,
      ...input,
      total_price: Number(input.quantity ?? baseItemInput.quantity) * Number(input.unit_price ?? baseItemInput.unit_price),
      net_amount: Number(input.quantity ?? baseItemInput.quantity) * Number(input.unit_price ?? baseItemInput.unit_price),
      tax_amount: 0,
      display_order: 0,
    }) as any);
    vi.spyOn(QuoteItem, 'delete').mockResolvedValue(true);
    vi.spyOn(QuoteItem, 'reorder').mockResolvedValue([] as any);
  });

  it('T042: createQuote requires billing:create permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { createQuote } = await import('../../src/actions/quoteActions');
    const result = await createQuote(baseQuoteInput as any);

    expect(result).toEqual({ permissionError: 'Permission denied: Cannot create quotes' });
    expect(Quote.create).not.toHaveBeenCalled();
  });

  it('T043: createQuote returns the created quote with generated number', async () => {
    vi.spyOn(Quote, 'getById').mockResolvedValue({ quote_id: QUOTE_ID, quote_number: 'Q-0007', title: baseQuoteInput.title } as any);

    const { createQuote } = await import('../../src/actions/quoteActions');
    const result = await createQuote(baseQuoteInput as any);

    expect(Quote.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({
        title: baseQuoteInput.title,
        created_by: USER_ID,
      })
    );
    expect(result).toMatchObject({ quote_id: QUOTE_ID, quote_number: 'Q-0007' });
  });

  it('T044: updateQuote enforces status transition rules', async () => {
    vi.spyOn(Quote, 'update').mockRejectedValue(new Error('Invalid quote status transition from draft to accepted'));

    const { updateQuote } = await import('../../src/actions/quoteActions');

    await expect(updateQuote(QUOTE_ID, { status: 'accepted' } as any)).rejects.toThrow(
      'Invalid quote status transition from draft to accepted'
    );
  });

  it('T045: deleteQuote rejects deletion of sent or accepted quotes', async () => {
    vi.spyOn(Quote, 'delete').mockRejectedValue(new Error('Quote with business history cannot be deleted; archive it instead'));

    const { deleteQuote } = await import('../../src/actions/quoteActions');

    await expect(deleteQuote(QUOTE_ID)).rejects.toThrow(
      'Quote with business history cannot be deleted; archive it instead'
    );
  });

  it('T046: addQuoteItem with service_id returns catalog-populated defaults', async () => {
    vi.spyOn(QuoteItem, 'create').mockResolvedValue({
      quote_item_id: QUOTE_ITEM_ID,
      ...baseItemInput,
      service_id: SERVICE_ID,
      service_name: 'Managed Endpoint',
      service_sku: 'ME-100',
      billing_method: 'fixed',
      unit_of_measure: 'device',
      total_price: 3000,
      net_amount: 3000,
      tax_amount: 0,
      display_order: 0,
    });

    const { addQuoteItem } = await import('../../src/actions/quoteActions');
    const result = await addQuoteItem({ ...baseItemInput, service_id: SERVICE_ID } as any);

    expect(QuoteItem.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({ service_id: SERVICE_ID, created_by: USER_ID })
    );
    expect(result).toMatchObject({
      service_name: 'Managed Endpoint',
      service_sku: 'ME-100',
      unit_price: 1500,
      billing_method: 'fixed',
    });
  });

  it('T047: addQuoteItem accepts all four billing methods', async () => {
    const { addQuoteItem } = await import('../../src/actions/quoteActions');
    const billingMethods = ['fixed', 'hourly', 'usage', 'per_unit'] as const;

    for (const billingMethod of billingMethods) {
      const result = await addQuoteItem({
        ...baseItemInput,
        billing_method: billingMethod,
      } as any);

      expect(result).toMatchObject({ billing_method: billingMethod });
    }
  });

  it('T048: addQuoteItem allows rate overrides different from catalog default', async () => {
    const { addQuoteItem } = await import('../../src/actions/quoteActions');
    const result = await addQuoteItem({
      ...baseItemInput,
      service_id: SERVICE_ID,
      unit_price: 2750,
    } as any);

    expect(QuoteItem.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({ service_id: SERVICE_ID, unit_price: 2750 })
    );
    expect(result).toMatchObject({ unit_price: 2750 });
  });

  it('T049: addQuoteItem stores is_optional when flagged', async () => {
    const { addQuoteItem } = await import('../../src/actions/quoteActions');
    const result = await addQuoteItem({
      ...baseItemInput,
      is_optional: true,
    } as any);

    expect(QuoteItem.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({ is_optional: true })
    );
    expect(result).toMatchObject({ is_optional: true });
  });

  it('T050: addQuoteItem stores recurring billing metadata', async () => {
    const { addQuoteItem } = await import('../../src/actions/quoteActions');
    const result = await addQuoteItem({
      ...baseItemInput,
      is_recurring: true,
      billing_frequency: 'monthly',
    } as any);

    expect(QuoteItem.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({ is_recurring: true, billing_frequency: 'monthly' })
    );
    expect(result).toMatchObject({ is_recurring: true, billing_frequency: 'monthly' });
  });

  it('T050a: creating a quote template keeps is_template=true and omits numbering', async () => {
    vi.spyOn(Quote, 'getById').mockResolvedValue({
      quote_id: QUOTE_ID,
      is_template: true,
      quote_number: null,
      title: 'Template quote',
    } as any);

    const { createQuote } = await import('../../src/actions/quoteActions');
    const result = await createQuote({
      ...baseQuoteInput,
      client_id: null,
      is_template: true,
    } as any);

    expect(Quote.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({ is_template: true })
    );
    expect(result).toMatchObject({ is_template: true, quote_number: null });
  });

  it('T050b: createQuoteFromTemplate copies all template items into a new draft quote', async () => {
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(templateQuote as any)
      .mockResolvedValueOnce({
        quote_id: QUOTE_ID,
        quote_number: 'Q-0099',
        is_template: false,
        quote_items: templateQuote.quote_items,
      } as any);

    const { createQuoteFromTemplate } = await import('../../src/actions/quoteActions');
    const result = await createQuoteFromTemplate(templateQuote.quote_id, {
      client_id: baseQuoteInput.client_id,
      quote_date: baseQuoteInput.quote_date,
      valid_until: baseQuoteInput.valid_until,
    } as any);

    expect(QuoteItem.create).toHaveBeenCalledTimes(2);
    expect(QuoteItem.create).toHaveBeenNthCalledWith(
      1,
      mockTrx,
      TENANT_ID,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        description: 'Managed Endpoint',
        is_optional: true,
        is_recurring: true,
        billing_frequency: 'monthly',
      })
    );
    expect(QuoteItem.create).toHaveBeenNthCalledWith(
      2,
      mockTrx,
      TENANT_ID,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        description: 'Onboarding',
        is_optional: false,
        is_recurring: false,
      })
    );
    expect(result).toMatchObject({ quote_id: QUOTE_ID, quote_items: templateQuote.quote_items });
  });

  it('T050c: createQuoteFromTemplate returns a newly numbered draft quote', async () => {
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(templateQuote as any)
      .mockResolvedValueOnce({
        quote_id: QUOTE_ID,
        quote_number: 'Q-0042',
        is_template: false,
        quote_items: [],
      } as any);

    const { createQuoteFromTemplate } = await import('../../src/actions/quoteActions');
    const result = await createQuoteFromTemplate(templateQuote.quote_id, {
      client_id: baseQuoteInput.client_id,
      quote_date: baseQuoteInput.quote_date,
      valid_until: baseQuoteInput.valid_until,
    } as any);

    expect(result).toMatchObject({ quote_number: 'Q-0042', is_template: false });
  });

  it('T050e: quote templates are excluded from the normal status lifecycle', async () => {
    vi.spyOn(Quote, 'update').mockRejectedValue(new Error('Quote templates do not participate in status transitions'));

    const { updateQuote } = await import('../../src/actions/quoteActions');

    await expect(updateQuote(QUOTE_ID, { status: 'sent' } as any)).rejects.toThrow(
      'Quote templates do not participate in status transitions'
    );
  });
});
