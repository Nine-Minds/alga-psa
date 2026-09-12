// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  addQuoteItem: vi.fn(),
  approveQuote: vi.fn(),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  convertQuoteToSalesOrder: vi.fn(),
  createQuote: vi.fn(),
  createQuoteFromTemplate: vi.fn(),
  createQuoteRevision: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  getQuote: vi.fn(),
  getQuoteApprovalSettings: vi.fn(),
  getQuoteConversionPreview: vi.fn(),
  listQuotes: vi.fn(),
  removeQuoteItem: vi.fn(),
  reorderQuoteItems: vi.fn(),
  requestQuoteApprovalChanges: vi.fn(),
  resendQuote: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
  submitQuoteForApproval: vi.fn(),
  updateQuote: vi.fn(),
  updateQuoteItem: vi.fn(),
}));

const getQuoteDocumentTemplatesMock = vi.hoisted(() => vi.fn());
const getAllClientsMock = vi.hoisted(() => vi.fn());
const getActiveLocationsMock = vi.hoisted(() => vi.fn());
const getContactsMock = vi.hoisted(() => vi.fn());
const getDefaultBillingSettingsMock = vi.hoisted(() => vi.fn());
const lineItemsEditorMock = vi.hoisted(() => ({ current: null as null | { items?: unknown[] } }));

vi.mock('../../src/actions/quoteActions', () => actions);
vi.mock('../../src/actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: (...args: unknown[]) => getQuoteDocumentTemplatesMock(...args),
}));
vi.mock('../../src/actions/billingClientsActions', () => ({
  getAllClientsForBilling: (...args: unknown[]) => getAllClientsMock(...args),
}));
vi.mock('../../src/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: (...args: unknown[]) => getActiveLocationsMock(...args),
}));
vi.mock('@alga-psa/user-composition/actions/contactQueryActions', () => ({
  getContactsForPicker: (...args: unknown[]) => getContactsMock(...args),
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => getDefaultBillingSettingsMock(...args),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: (value: any) => Boolean(value && value.messageKey),
  isActionPermissionError: (value: any) => Boolean(value && value.permissionError),
  getErrorMessage: (value: any) =>
    (value && (value.permissionError || value.message)) || 'error',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${Number(value ?? 0).toFixed(2)}`,
    formatDate: (value: string) => String(value),
  }),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));

vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: any) => React.createElement('div', null, children),
  Box: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, onClick, disabled }: any) =>
    React.createElement('button', { id, onClick, disabled, type: 'button' }, children),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ value, onChange, disabled, id }: any) =>
    React.createElement('input', { id, value: value ?? '', onChange, disabled }),
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ value, onChange, disabled, id }: any) =>
    React.createElement('textarea', { id, value: value ?? '', onChange, disabled }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) =>
    React.createElement(
      'select',
      { id, value: value ?? '', onChange: (event: any) => onValueChange(event.target.value) },
      (options ?? []).map((option: any) =>
        React.createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
}));

vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({
  default: ({ id, value, onValueChange }: any) =>
    React.createElement(
      'select',
      { id, value: value ?? '', onChange: (event: any) => onValueChange(event.target.value) },
      React.createElement('option', { key: 'USD', value: 'USD' }, 'USD'),
      React.createElement('option', { key: 'EUR', value: 'EUR' }, 'EUR'),
    ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => React.createElement('div', null, children),
  AlertTitle: ({ children }: any) => React.createElement('div', null, children),
  AlertDescription: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => React.createElement('div', null, children),
  DropdownMenuContent: ({ children }: any) => React.createElement('div', null, children),
  DropdownMenuItem: ({ children }: any) => React.createElement('button', { type: 'button' }, children),
  DropdownMenuTrigger: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: () => null,
  DialogContent: ({ children }: any) => React.createElement('div', null, children),
  DialogDescription: ({ children }: any) => React.createElement('div', null, children),
  DialogHeader: ({ children }: any) => React.createElement('div', null, children),
  DialogTitle: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('../../src/components/billing-dashboard/quotes/QuoteLineItemsEditor', () => ({
  default: (props: any) => {
    lineItemsEditorMock.current = props;
    return null;
  },
}));
vi.mock('../../src/components/billing-dashboard/quotes/QuoteSendRecipientsField', () => ({
  QuoteSendRecipientsField: () => null,
}));
vi.mock('../../src/components/billing-dashboard/quotes/QuoteStatusBadge', () => ({
  default: () => null,
}));
vi.mock('../../src/components/billing-dashboard/quotes/quoteLineItemDraft', () => ({
  createDraftQuoteItemFromQuoteItem: (item: any) => ({
    local_id: item.quote_item_id,
    quote_item_id: item.quote_item_id,
    description: item.description,
    quantity: Number(item.quantity ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    is_optional: Boolean(item.is_optional),
    is_selected: item.is_selected ?? true,
    is_recurring: Boolean(item.is_recurring),
    is_discount: Boolean(item.is_discount),
    billing_frequency: item.billing_frequency ?? null,
    is_taxable: item.is_taxable ?? true,
    location_id: null,
  }),
  calculateDraftQuoteTotals: () => ({ subtotal: 0, discount_total: 0, tax: 0, total_amount: 0 }),
  calculateDraftMonthlyRecurringNet: () => 0,
  formatDraftQuoteMoney: (value: number) => `$${(Number(value ?? 0) / 100).toFixed(2)}`,
  resolveDraftDiscountAmounts: () => new Map(),
}));

import QuoteForm from '../../src/components/billing-dashboard/quotes/QuoteForm';

const template = {
  quote_id: 'tmpl-1',
  title: 'Template Title',
  description: 'Template description',
  client_notes: 'Template notes',
  terms_and_conditions: 'Terms line one\n\nTerms line two',
  currency_code: 'EUR',
  po_number: 'PO-123',
  is_template: true,
  quote_items: [
    {
      quote_item_id: 'ti-1',
      description: 'Managed Endpoint',
      quantity: 3,
      unit_price: 1200,
      is_recurring: true,
      is_taxable: true,
      is_optional: false,
      is_selected: true,
    },
    {
      quote_item_id: 'ti-2',
      description: 'Onboarding',
      quantity: 1,
      unit_price: 5000,
      is_recurring: false,
      is_taxable: true,
      is_optional: false,
      is_selected: true,
    },
  ],
};

const editQuote = {
  quote_id: 'quote-1',
  quote_number: 'Q-1',
  title: '',
  status: 'draft',
  client_id: 'client-1',
  contact_id: '',
  template_id: 'layout-9',
  currency_code: 'USD',
  quote_items: [],
  updated_at: '2026-01-01T00:00:00.000Z',
};

const renderForm = (props: Record<string, unknown> = {}) =>
  render(
    <QuoteForm quoteId="new" onCancel={vi.fn()} onSaved={vi.fn()} {...(props as any)} />,
  );

describe('QuoteForm template instantiation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lineItemsEditorMock.current = null;
    actions.listQuotes.mockResolvedValue({
      data: [{ quote_id: 'tmpl-1', title: 'Template Title', currency_code: 'EUR' }],
    });
    getQuoteDocumentTemplatesMock.mockResolvedValue([]);
    actions.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    getDefaultBillingSettingsMock.mockResolvedValue({ defaultCurrencyCode: 'USD' });
    getAllClientsMock.mockResolvedValue([]);
    getActiveLocationsMock.mockResolvedValue([]);
    getContactsMock.mockResolvedValue([]);
    actions.createQuoteFromTemplate.mockResolvedValue({
      quote_id: 'new-1',
      quote_items: template.quote_items,
    });
    actions.createQuote.mockResolvedValue({ quote_id: 'new-2', quote_items: [] });
    actions.updateQuote.mockResolvedValue({ quote_id: 'quote-1' });
    actions.addQuoteItem.mockResolvedValue({ quote_item_id: 'qi-new' });
    actions.updateQuoteItem.mockResolvedValue({ quote_item_id: 'qi-new' });
  });

  afterEach(() => {
    cleanup();
  });

  it('T002: deep link prefills terms, notes, description, PO number, currency and line items', async () => {
    actions.getQuote.mockResolvedValue(template);
    const view = renderForm({ initialContext: { clientId: 'client-1', sourceTemplateId: 'tmpl-1' } });

    await waitFor(() => expect(lineItemsEditorMock.current?.items).toHaveLength(2));
    expect(actions.getQuote).toHaveBeenCalledWith('tmpl-1');

    // Seed once (F007): a re-render with fresh prop identities must not
    // re-apply the template. This fails loudly if the loadFormData effect
    // dependency list is ever broadened (and the once-guard is not there).
    view.rerender(
      <QuoteForm
        quoteId="new"
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        initialContext={{ clientId: 'client-1', sourceTemplateId: 'tmpl-1' }}
      />,
    );
    await waitFor(() => expect(actions.getQuote).toHaveBeenCalledTimes(1));

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuoteFromTemplate).toHaveBeenCalledTimes(1));

    const [templateId, payload] = actions.createQuoteFromTemplate.mock.calls[0];
    expect(templateId).toBe('tmpl-1');
    expect(payload).toMatchObject({
      title: 'Template Title',
      description: 'Template description',
      client_notes: 'Template notes',
      terms_and_conditions: 'Terms line one\n\nTerms line two',
      po_number: 'PO-123',
      currency_code: 'EUR',
    });
  });

  it('T003: deep-linked create routes through createQuoteFromTemplate without re-persisting line items', async () => {
    actions.getQuote.mockResolvedValue(template);
    const view = renderForm({ initialContext: { clientId: 'client-1', sourceTemplateId: 'tmpl-1' } });

    await waitFor(() => expect(lineItemsEditorMock.current?.items).toHaveLength(2));

    // Seed once (F007): re-rendering must not fetch/apply the source template a
    // second time, so the server-created line items are not re-seeded.
    view.rerender(
      <QuoteForm
        quoteId="new"
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        initialContext={{ clientId: 'client-1', sourceTemplateId: 'tmpl-1' }}
      />,
    );
    await waitFor(() => expect(actions.getQuote).toHaveBeenCalledTimes(1));

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuoteFromTemplate).toHaveBeenCalledTimes(1));

    expect(actions.createQuote).not.toHaveBeenCalled();
    expect(actions.addQuoteItem).not.toHaveBeenCalled();
    expect(actions.updateQuoteItem).not.toHaveBeenCalled();
  });

  it('T004: edit mode leaves the source template empty and round-trips the layout id', async () => {
    actions.getQuote.mockResolvedValue(editQuote);
    getQuoteDocumentTemplatesMock.mockResolvedValue([
      { template_id: 'layout-9', name: 'Custom Layout', isStandard: false },
    ]);

    renderForm({ quoteId: 'quote-1' });

    const titleInput = await screen.findByLabelText('Title');
    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getByText('Title is required unless creating from template')).toBeTruthy(),
    );
    expect(actions.updateQuote).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: 'Edited title' } });
    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);

    await waitFor(() => expect(actions.updateQuote).toHaveBeenCalledTimes(1));
    const [, payload] = actions.updateQuote.mock.calls[0];
    expect(payload).toMatchObject({ title: 'Edited title', template_id: 'layout-9' });
    expect(payload).not.toHaveProperty('source_template_id');
  });

  it('T005: a deep link naming a missing template degrades to a blank, submittable quote', async () => {
    actions.getQuote.mockResolvedValue(null);
    renderForm({
      initialContext: { clientId: 'client-1', title: 'Draft quote', sourceTemplateId: 'missing' },
    });

    await screen.findByLabelText('Title');
    expect(actions.getQuote).toHaveBeenCalledWith('missing');

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuote).toHaveBeenCalledTimes(1));

    expect(actions.createQuoteFromTemplate).not.toHaveBeenCalled();
    const [payload] = actions.createQuote.mock.calls[0];
    expect(payload).toMatchObject({ title: 'Draft quote' });
    expect(payload.terms_and_conditions).toBeNull();
  });

  it('T006: an opportunity-seeded title survives template prefill', async () => {
    actions.getQuote.mockResolvedValue(template);
    renderForm({
      initialContext: {
        clientId: 'client-1',
        title: 'Opportunity Title',
        sourceTemplateId: 'tmpl-1',
      },
    });

    await waitFor(() => expect(lineItemsEditorMock.current?.items).toHaveLength(2));

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuoteFromTemplate).toHaveBeenCalledTimes(1));

    const [, payload] = actions.createQuoteFromTemplate.mock.calls[0];
    expect(payload.title).toBe('Opportunity Title');
  });

  it('T007: the "+ From template" picker still prefills after the rename', async () => {
    actions.getQuote.mockResolvedValue(template);
    renderForm({ initialContext: { clientId: 'client-1' } });

    await waitFor(() =>
      expect(document.getElementById('quote-form-template-picker')).not.toBeNull(),
    );
    fireEvent.change(document.getElementById('quote-form-template-picker') as HTMLSelectElement, {
      target: { value: 'tmpl-1' },
    });

    await waitFor(() => expect(lineItemsEditorMock.current?.items).toHaveLength(2));

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuoteFromTemplate).toHaveBeenCalledTimes(1));

    const [templateId, payload] = actions.createQuoteFromTemplate.mock.calls[0];
    expect(templateId).toBe('tmpl-1');
    expect(payload.terms_and_conditions).toBe('Terms line one\n\nTerms line two');
  });
});
