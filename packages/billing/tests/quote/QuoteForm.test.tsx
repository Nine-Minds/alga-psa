// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const quickAddClientMock = vi.hoisted(() => ({ current: null as null | Record<string, any> }));
const lineItemsEditorMock = vi.hoisted(() => ({ current: null as null | { items?: unknown[] } }));
const termsEditorMock = vi.hoisted(() => ({ current: null as null | { onContentChange?: (blocks: unknown[]) => void } }));

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
    t: (key: string, options?: { defaultValue?: string; [token: string]: unknown }) => {
      let value = options?.defaultValue ?? key;
      for (const [token, replacement] of Object.entries(options ?? {})) {
        if (token !== 'defaultValue') {
          value = value.split(`{{${token}}}`).join(String(replacement));
        }
      }
      return value;
    },
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({
    renderQuickAddClient: (config: Record<string, any>) => {
      quickAddClientMock.current = config;
      return null;
    },
  }),
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
      React.createElement('option', { key: 'GBP', value: 'GBP' }, 'GBP'),
      React.createElement('option', { key: 'AUD', value: 'AUD' }, 'AUD'),
    ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, selectedClientId, onSelect }: any) =>
    React.createElement(
      'select',
      { id, value: selectedClientId ?? '', onChange: (event: any) => onSelect(event.target.value) },
      React.createElement('option', { key: '', value: '' }, ''),
      (clients ?? []).map((client: any) =>
        React.createElement('option', { key: client.client_id, value: client.client_id }, client.client_name),
      ),
    ),
}));
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

// The Terms & Conditions field renders the rich-text TextEditor from
// @alga-psa/ui/editor. That component pulls in useFeatureFlag -> useSession,
// which throws outside a <SessionProvider /> in non-production builds. These
// tests exercise QuoteForm's template/persistence behaviour rather than the
// editor internals, so stub the editor module the same way every other UI
// dependency is stubbed above. The stub still forwards typed content through
// onContentChange so the editor -> form wiring stays under test.
vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: (props: any) => {
    termsEditorMock.current = props;
    return React.createElement('textarea', {
      id: props.id,
      'data-testid': 'quote-terms-editor-input',
      placeholder: props.placeholder,
      onChange: (event: any) =>
        props.onContentChange?.([
          { type: 'paragraph', content: [{ type: 'text', text: event.target.value, styles: {} }] },
        ]),
    });
  },
  QuoteTermsContent: ({ text }: any) => React.createElement('div', null, text ?? ''),
  hasQuoteTermsContent: (block: unknown, text?: string | null) => Boolean(block) || Boolean(text),
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
    termsEditorMock.current = null;
    quickAddClientMock.current = null;
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

  it('T008: editing the rich-text terms editor flows the plain-text projection into the saved quote', async () => {
    actions.getQuote.mockResolvedValue(null);
    renderForm({ initialContext: { clientId: 'client-1', title: 'Draft quote' } });

    // The rich-text editor must render without a SessionProvider crash and be
    // wired to the form: typing content updates the persisted plain-text terms.
    const editor = (await screen.findByTestId('quote-terms-editor-input')) as HTMLTextAreaElement;
    expect(termsEditorMock.current).not.toBeNull();
    fireEvent.change(editor, { target: { value: 'Net 30. See https://example.com/terms' } });

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);
    await waitFor(() => expect(actions.createQuote).toHaveBeenCalledTimes(1));

    const [payload] = actions.createQuote.mock.calls[0];
    expect(payload.terms_and_conditions).toBe('Net 30. See https://example.com/terms');
    expect(payload.terms_and_conditions_block).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Net 30. See https://example.com/terms', styles: {} }] },
    ]);
  });
});

describe('QuoteForm currency source resolution', () => {
  const readCurrency = () =>
    (document.getElementById('quote-currency') as HTMLSelectElement).value;
  const readSource = () =>
    document.getElementById('quote-currency-source')?.textContent ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
    lineItemsEditorMock.current = null;
    termsEditorMock.current = null;
    quickAddClientMock.current = null;
    actions.listQuotes.mockResolvedValue({
      data: [{ quote_id: 'tmpl-1', title: 'Template Title', currency_code: 'EUR' }],
    });
    getQuoteDocumentTemplatesMock.mockResolvedValue([]);
    actions.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    getDefaultBillingSettingsMock.mockResolvedValue({ defaultCurrencyCode: 'USD' });
    getAllClientsMock.mockResolvedValue([]);
    getActiveLocationsMock.mockResolvedValue([]);
    getContactsMock.mockResolvedValue([]);
    actions.createQuote.mockResolvedValue({ quote_id: 'new-2', quote_items: [] });
    actions.updateQuote.mockResolvedValue({ quote_id: 'quote-1' });
    actions.createQuoteFromTemplate.mockResolvedValue({ quote_id: 'new-1', quote_items: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('F008/F009/F015: seeds the initial-context client currency and re-resolves on select and clear', async () => {
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-aud', client_name: 'Aussie Co', default_currency_code: 'AUD' },
      { client_id: 'client-gbp', client_name: 'Brit Co', default_currency_code: 'GBP' },
    ]);

    renderForm({ initialContext: { clientId: 'client-aud' } });

    await screen.findByLabelText('Title');
    await waitFor(() => expect(readSource()).toBe('Client default for Aussie Co'));
    expect(readCurrency()).toBe('AUD');

    fireEvent.change(document.getElementById('quote-client') as HTMLSelectElement, {
      target: { value: 'client-gbp' },
    });
    await waitFor(() => expect(readSource()).toBe('Client default for Brit Co'));
    expect(readCurrency()).toBe('GBP');

    fireEvent.change(document.getElementById('quote-client') as HTMLSelectElement, {
      target: { value: '' },
    });
    await waitFor(() => expect(readSource()).toBe('Tenant default'));
    expect(readCurrency()).toBe('USD');
  });

  it('F010: quick-adding a client applies its default currency and client source', async () => {
    renderForm();

    await screen.findByLabelText('Title');
    await waitFor(() => expect(quickAddClientMock.current).not.toBeNull());

    act(() => {
      quickAddClientMock.current!.onClientAdded({
        client_id: 'client-new',
        client_name: 'New Co',
        default_currency_code: 'GBP',
      });
    });

    await waitFor(() => expect(readSource()).toBe('Client default for New Co'));
    expect(readCurrency()).toBe('GBP');
  });

  it('F011/F012: a business template overrides the client currency and a manual pick sets manual source', async () => {
    getAllClientsMock.mockResolvedValue([
      { client_id: 'client-aud', client_name: 'Aussie Co', default_currency_code: 'AUD' },
      { client_id: 'client-gbp', client_name: 'Brit Co', default_currency_code: 'GBP' },
    ]);
    actions.getQuote.mockResolvedValue(template);

    renderForm({ initialContext: { clientId: 'client-aud' } });

    await waitFor(() => expect(readSource()).toBe('Client default for Aussie Co'));

    fireEvent.change(document.getElementById('quote-form-template-picker') as HTMLSelectElement, {
      target: { value: 'tmpl-1' },
    });
    await waitFor(() => expect(readSource()).toBe('From quote template Template Title'));
    expect(readCurrency()).toBe('EUR');

    // A source template outranks client defaulting: changing the client keeps
    // the template currency and its source label.
    fireEvent.change(document.getElementById('quote-client') as HTMLSelectElement, {
      target: { value: 'client-gbp' },
    });
    await waitFor(() => expect(readSource()).toBe('From quote template Template Title'));
    expect(readCurrency()).toBe('EUR');

    fireEvent.change(document.getElementById('quote-currency') as HTMLSelectElement, {
      target: { value: 'GBP' },
    });
    await waitFor(() => expect(readSource()).toBe('Selected manually'));
    expect(readCurrency()).toBe('GBP');
  });

  it('F013: editing a saved quote keeps its currency and labels it saved rather than re-defaulting', async () => {
    getDefaultBillingSettingsMock.mockResolvedValue({ defaultCurrencyCode: 'AUD' });
    actions.getQuote.mockResolvedValue({ ...editQuote, currency_code: 'USD' });

    renderForm({ quoteId: 'quote-1' });

    await screen.findByLabelText('Title');
    await waitFor(() => expect(readSource()).toBe('Saved on this quote'));
    expect(readCurrency()).toBe('USD');
  });

  it('F014: editing a saved business template labels the saved-on-template source', async () => {
    actions.getQuote.mockResolvedValue({ ...template, is_template: true, currency_code: 'EUR' });

    renderForm({ quoteId: 'tmpl-1', initialIsTemplate: true });

    await waitFor(() => expect(readSource()).toBe('Saved on this template'));
    expect(readCurrency()).toBe('EUR');
  });
});
