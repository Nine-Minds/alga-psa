import { beforeEach, describe, expect, it, vi } from 'vitest';
import Quote from '../../src/models/quote';
import QuoteActivity from '../../src/models/quoteActivity';
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
const mockKnex: any = vi.fn();
mockKnex.transaction = async (handler: (trx: typeof mockTrx) => Promise<unknown>) => handler(mockTrx);
const createTenantKnex = vi.fn();
const hasPermissionMock = vi.fn();
const sendEmailMock = vi.fn();
const getTenantEmailServiceInstance = vi.fn(() => ({ sendEmail: (...args: any[]) => sendEmailMock(...args) }));
const generatePDFMock = vi.fn();
const approvalSettingsMock = vi.fn();

const makeQuery = (result: any) => {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.first = vi.fn(async () => result);
  return chain;
};

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

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: (...args: any[]) => getTenantEmailServiceInstance(...args),
  },
}));

vi.mock('../../src/lib/quoteApprovalSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/quoteApprovalSettings')>();
  return {
    ...actual,
    getQuoteApprovalWorkflowSettings: (...args: any[]) => approvalSettingsMock(...args),
  };
});

vi.mock('../../src/services', () => ({
  buildQuoteConversionPreview: vi.fn(),
  convertQuoteToDraftContract: vi.fn(),
  convertQuoteToDraftContractAndInvoice: vi.fn(),
  convertQuoteToDraftInvoice: vi.fn(),
  createQuotePDFGenerationService: vi.fn(() => ({
    generatePDF: (...args: any[]) => generatePDFMock(...args),
  })),
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
    mockKnex.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return makeQuery({ client_name: 'Acme MSP' });
      }
      throw new Error(`Unexpected mockKnex table access: ${table}`);
    });
    createTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: TENANT_ID });
    hasPermissionMock.mockResolvedValue(true);
    generatePDFMock.mockResolvedValue(Buffer.from('pdf-content'));
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'message-1' });
    approvalSettingsMock.mockResolvedValue({ approvalRequired: false });
    vi.spyOn(Quote, 'create').mockResolvedValue({ quote_id: QUOTE_ID } as any);
    vi.spyOn(Quote, 'update').mockResolvedValue({ quote_id: QUOTE_ID } as any);
    vi.spyOn(Quote, 'getById').mockResolvedValue({ quote_id: QUOTE_ID, quote_number: 'Q-0001' } as any);
    vi.spyOn(Quote, 'listByTenant').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 1 } as any);
    vi.spyOn(Quote, 'delete').mockResolvedValue(undefined as any);
    vi.spyOn(QuoteActivity, 'create').mockResolvedValue({ activity_id: 'activity-1' } as any);
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

  it('T050d: listQuotes separates template and non-template views with is_template filtering', async () => {
    const { listQuotes } = await import('../../src/actions/quoteActions');

    await listQuotes({ is_template: true });
    await listQuotes();

    expect(Quote.listByTenant).toHaveBeenNthCalledWith(1, mockKnex, TENANT_ID, { is_template: true });
    expect(Quote.listByTenant).toHaveBeenNthCalledWith(2, mockKnex, TENANT_ID, {});
  });

  it('T050e: quote templates are excluded from the normal status lifecycle', async () => {
    vi.spyOn(Quote, 'update').mockRejectedValue(new Error('Quote templates do not participate in status transitions'));

    const { updateQuote } = await import('../../src/actions/quoteActions');

    await expect(updateQuote(QUOTE_ID, { status: 'sent' } as any)).rejects.toThrow(
      'Quote templates do not participate in status transitions'
    );
  });


  it('T119: submitQuoteForApproval changes status from draft to pending_approval', async () => {
    vi.spyOn(Quote, 'getById').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'draft',
      is_template: false,
    } as any);
    vi.spyOn(Quote, 'update').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'pending_approval',
    } as any);

    const { submitQuoteForApproval } = await import('../../src/actions/quoteActions');
    const result = await submitQuoteForApproval(QUOTE_ID);

    expect(Quote.update).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      QUOTE_ID,
      expect.objectContaining({
        status: 'pending_approval',
        updated_by: USER_ID,
      })
    );
    expect(result).toMatchObject({ quote_id: QUOTE_ID, status: 'pending_approval' });
  });


  it('T120: approveQuote changes status from pending_approval to approved', async () => {
    vi.spyOn(Quote, 'getById').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'pending_approval',
      is_template: false,
    } as any);
    vi.spyOn(Quote, 'update').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'approved',
    } as any);

    const { approveQuote } = await import('../../src/actions/quoteActions');
    const result = await approveQuote(QUOTE_ID, 'Looks good');

    expect(Quote.update).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      QUOTE_ID,
      expect.objectContaining({
        status: 'approved',
        updated_by: USER_ID,
      })
    );
    expect(QuoteActivity.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        activity_type: 'approved',
        description: 'Quote approved: Looks good',
        metadata: { comment: 'Looks good' },
      })
    );
    expect(result).toMatchObject({ quote_id: QUOTE_ID, status: 'approved' });
  });


  it('T121: requestQuoteApprovalChanges returns a pending quote to draft with comment', async () => {
    vi.spyOn(Quote, 'getById').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'pending_approval',
      is_template: false,
    } as any);
    vi.spyOn(Quote, 'update').mockResolvedValueOnce({
      quote_id: QUOTE_ID,
      status: 'draft',
    } as any);

    const { requestQuoteApprovalChanges } = await import('../../src/actions/quoteActions');
    const result = await requestQuoteApprovalChanges(QUOTE_ID, 'Please revise pricing');

    expect(Quote.update).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      QUOTE_ID,
      expect.objectContaining({
        status: 'draft',
        updated_by: USER_ID,
      })
    );
    expect(QuoteActivity.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        activity_type: 'approval_changes_requested',
        description: 'Approval changes requested: Please revise pricing',
        metadata: { comment: 'Please revise pricing' },
      })
    );
    expect(result).toMatchObject({ quote_id: QUOTE_ID, status: 'draft' });
  });


  it('T122: approveQuote requires quotes:approve permission', async () => {
    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => (
      !(resource === 'quotes' && action === 'approve')
    ));

    const { approveQuote } = await import('../../src/actions/quoteActions');
    const result = await approveQuote(QUOTE_ID, 'Denied');

    expect(result).toEqual({ permissionError: 'Permission denied: Cannot approve quotes' });
    expect(Quote.update).not.toHaveBeenCalled();
    expect(QuoteActivity.create).not.toHaveBeenCalled();
  });

  it('T089: sendQuote rejects quotes not in draft or approved status', async () => {
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce({
        quote_id: QUOTE_ID,
        quote_number: 'Q-0001',
        title: 'Quote',
        total_amount: 5000,
        currency_code: 'USD',
        valid_until: '2026-03-20T00:00:00.000Z',
        status: 'sent',
        is_template: false,
        client_id: null,
        contact_id: null,
      } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');

    await expect(sendQuote(QUOTE_ID, { email_addresses: ['client@example.com'] })).rejects.toThrow(
      'Only draft or approved quotes can be sent'
    );
  });

  it('T090: sendQuote generates PDF, sends email, and updates status to sent', async () => {
    const sendableQuote = {
      quote_id: QUOTE_ID,
      quote_number: 'Q-0001',
      title: 'Quote',
      total_amount: 5000,
      currency_code: 'USD',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      is_template: false,
      client_id: null,
      contact_id: null,
    };
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(sendableQuote as any)
      .mockResolvedValueOnce({ ...sendableQuote, status: 'sent', sent_at: '2026-03-13T12:00:00.000Z' } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');
    const result = await sendQuote(QUOTE_ID, { email_addresses: ['client@example.com'] });

    expect(generatePDFMock).toHaveBeenCalledWith({ quoteId: QUOTE_ID });
    expect(sendEmailMock).toHaveBeenCalled();
    expect(Quote.update).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      QUOTE_ID,
      expect.objectContaining({ status: 'sent', updated_by: USER_ID, sent_at: expect.any(String) })
    );
    expect(result).toMatchObject({ status: 'sent' });
  });

  it('T090a: sendQuote sends to all provided email addresses', async () => {
    const sendableQuote = {
      quote_id: QUOTE_ID,
      quote_number: 'Q-0001',
      title: 'Quote',
      total_amount: 5000,
      currency_code: 'USD',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      is_template: false,
      client_id: null,
      contact_id: null,
    };
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(sendableQuote as any)
      .mockResolvedValueOnce({ ...sendableQuote, status: 'sent' } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');
    await sendQuote(QUOTE_ID, { email_addresses: ['one@example.com', 'two@example.com'] });

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: ['one@example.com', 'two@example.com'],
    }));
  });

  it('T091: sendQuote logs a sent activity', async () => {
    const sendableQuote = {
      quote_id: QUOTE_ID,
      quote_number: 'Q-0001',
      title: 'Quote',
      total_amount: 5000,
      currency_code: 'USD',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      is_template: false,
      client_id: null,
      contact_id: null,
    };
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(sendableQuote as any)
      .mockResolvedValueOnce({ ...sendableQuote, status: 'sent' } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');
    await sendQuote(QUOTE_ID, { email_addresses: ['client@example.com'] });

    expect(QuoteActivity.create).toHaveBeenCalledWith(
      mockKnex,
      TENANT_ID,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        activity_type: 'sent',
        metadata: expect.objectContaining({ recipients: ['client@example.com'], message_id: 'message-1' }),
      })
    );
  });

  it('T092: quote sent email includes summary details and PDF attachment', async () => {
    const sendableQuote = {
      quote_id: QUOTE_ID,
      quote_number: 'Q-0001',
      title: 'Quote',
      total_amount: 5000,
      currency_code: 'USD',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      is_template: false,
      client_id: null,
      contact_id: null,
    };
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(sendableQuote as any)
      .mockResolvedValueOnce({ ...sendableQuote, status: 'sent' } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');
    await sendQuote(QUOTE_ID, { email_addresses: ['client@example.com'] });

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Quote Q-0001 from Acme MSP',
      html: expect.stringContaining('Q-0001'),
      text: expect.stringContaining('Valid Until:'),
      attachments: [expect.objectContaining({ filename: 'Quote_Q-0001.pdf', content: Buffer.from('pdf-content') })],
    }));
  });

  it('T093: sendQuote passes quote entity metadata for email logging', async () => {
    const sendableQuote = {
      quote_id: QUOTE_ID,
      quote_number: 'Q-0001',
      title: 'Quote',
      total_amount: 5000,
      currency_code: 'USD',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      is_template: false,
      client_id: null,
      contact_id: null,
    };
    vi.spyOn(Quote, 'getById')
      .mockResolvedValueOnce(sendableQuote as any)
      .mockResolvedValueOnce({ ...sendableQuote, status: 'sent' } as any);

    const { sendQuote } = await import('../../src/actions/quoteActions');
    await sendQuote(QUOTE_ID, { email_addresses: ['client@example.com'] });

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'quote',
      entityId: QUOTE_ID,
    }));
  });
});
