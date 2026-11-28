// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftQuoteItem } from './quoteLineItemDraft';

vi.mock('@alga-psa/email/senderActions', () => ({
  listSelectableSenders: vi.fn(async () => ({ senders: [], effectiveSenderId: null, effectiveSenderAddress: 'provider@example.test', effectiveSenderDisplayName: 'Provider', allowOverride: false })),
}));

const actionMocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  createQuoteFromTemplate: vi.fn(),
  updateQuote: vi.fn(),
  getQuote: vi.fn(),
  getQuoteDocumentTemplates: vi.fn(),
  getQuoteApprovalSettings: vi.fn(),
  listQuotes: vi.fn(),
  getClientByIdForBilling: vi.fn(),
  getActiveClientLocationsForBilling: vi.fn(),
  getContactsForPicker: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
  updateQuoteItem: vi.fn(),
  addQuoteItem: vi.fn(),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: () => <div data-testid="terms-editor" />,
  QuoteTermsContent: () => <div data-testid="terms-readonly" />,
}));

vi.mock('../../../actions/quoteActions', () => ({
  createQuote: (...args: unknown[]) => actionMocks.createQuote(...args),
  createQuoteFromTemplate: (...args: unknown[]) => actionMocks.createQuoteFromTemplate(...args),
  updateQuote: (...args: unknown[]) => actionMocks.updateQuote(...args),
  getQuote: (...args: unknown[]) => actionMocks.getQuote(...args),
  getQuoteApprovalSettings: (...args: unknown[]) => actionMocks.getQuoteApprovalSettings(...args),
  listQuotes: (...args: unknown[]) => actionMocks.listQuotes(...args),
  updateQuoteItem: (...args: unknown[]) => actionMocks.updateQuoteItem(...args),
  addQuoteItem: (...args: unknown[]) => actionMocks.addQuoteItem(...args),
  approveQuote: vi.fn(),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  convertQuoteToSalesOrder: vi.fn(),
  createQuoteRevision: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  getQuoteConversionPreview: vi.fn(),
  markQuoteAccepted: vi.fn(),
  removeQuoteItem: vi.fn(),
  reorderQuoteItems: vi.fn(),
  requestQuoteApprovalChanges: vi.fn(),
  resendQuote: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
  submitQuoteForApproval: vi.fn(),
}));
vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: (...args: unknown[]) => actionMocks.getQuoteDocumentTemplates(...args),
}));
vi.mock('../../../actions/billingClientsActions', () => ({
  getClientByIdForBilling: (...args: unknown[]) => actionMocks.getClientByIdForBilling(...args),
}));
vi.mock('../../../actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: (...args: unknown[]) => actionMocks.getActiveClientLocationsForBilling(...args),
}));
vi.mock('@alga-psa/user-composition/actions/contactQueryActions', () => ({
  getContactsForPicker: (...args: unknown[]) => actionMocks.getContactsForPicker(...args),
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => actionMocks.getDefaultBillingSettings(...args),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatCurrency: (v: number) => `$${v}`, formatDate: (v: string) => v }),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String((options as any)?.[name] ?? '')),
  }),
}));
vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, disabled, type }: any) => (
    <button id={id} type={type ?? 'button'} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: (props: any) => <textarea {...props} /> }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <div data-testid="loading" /> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id, onClick }: any) => <button id={id} onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/context', () => ({ useQuickAddClient: () => ({ renderQuickAddClient: () => null }) }));
vi.mock('./QuoteSendRecipientsField', () => ({ QuoteSendRecipientsField: () => <div /> }));
vi.mock('./QuoteStatusBadge', () => ({ default: () => <div /> }));

type EditorProps = { items: DraftQuoteItem[]; onChange: (items: DraftQuoteItem[]) => void };
let editorProps: EditorProps | null = null;
vi.mock('./QuoteLineItemsEditor', () => ({
  default: (props: EditorProps) => {
    editorProps = props;
    return <div data-testid="line-items-editor" />;
  },
}));

import QuoteForm from './QuoteForm';

const baseRow = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  quote_id: 'quote-1',
  quantity: 1,
  unit_price: 1000,
  total_price: 1000,
  net_amount: 1000,
  tax_amount: 0,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  ...overrides,
});

const EXISTING_QUOTE = {
  quote_id: 'quote-1',
  title: 'Managed services',
  client_id: 'client-1',
  status: 'draft',
  currency_code: 'USD',
  quote_items: [
    baseRow({ quote_item_id: 'item-a', description: 'Firewall', service_id: 'svc-1', catalog_description: 'Original text', display_order: 0 }),
    baseRow({ quote_item_id: 'item-b', description: 'Backup', service_id: 'svc-2', catalog_description: 'Backup text', display_order: 1 }),
  ],
};

const lastSavedItems = (id: string) =>
  actionMocks.updateQuoteItem.mock.calls.find((call) => call[0] === id)?.[1] as Record<string, unknown>;

describe('QuoteForm product-description payload (alga-2026-0002804)', () => {
  beforeEach(() => {
    editorProps = null;
    vi.clearAllMocks();
    actionMocks.getDefaultBillingSettings.mockResolvedValue({ defaultCurrencyCode: 'USD' });
    actionMocks.getClientByIdForBilling.mockResolvedValue(null);
    actionMocks.getContactsForPicker.mockResolvedValue([]);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getQuoteDocumentTemplates.mockResolvedValue([]);
    actionMocks.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    actionMocks.listQuotes.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 200, totalPages: 0 });
    actionMocks.getQuote.mockResolvedValue(EXISTING_QUOTE);
    actionMocks.updateQuote.mockResolvedValue({ ...EXISTING_QUOTE });
    actionMocks.updateQuoteItem.mockImplementation(async (id: string) =>
      EXISTING_QUOTE.quote_items.find((row: Record<string, unknown>) => row.quote_item_id === id));
  });
  afterEach(() => cleanup());

  const renderAndSave = async (mutate: (items: DraftQuoteItem[]) => DraftQuoteItem[]) => {
    render(<QuoteForm quoteId="quote-1" onCancel={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(editorProps?.items.length).toBe(2));
    await act(async () => { editorProps!.onChange(mutate(editorProps!.items)); });
    await act(async () => {
      (document.getElementById('quote-form-save') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(actionMocks.updateQuoteItem).toHaveBeenCalledTimes(2));
  };

  it('sends catalog_description only for the dirty line; an untouched line omits the key', async () => {
    await renderAndSave((items) => items.map((item) =>
      item.quote_item_id === 'item-a'
        ? { ...item, catalog_description: '  Edited wording  ', catalog_description_dirty: true }
        : item));

    expect(lastSavedItems('item-a')).toMatchObject({ catalog_description: 'Edited wording' });
    expect('catalog_description' in lastSavedItems('item-b')).toBe(false);
    // The flag is never sent by the client.
    expect('catalog_description_edited' in lastSavedItems('item-a')).toBe(false);
  });

  it('sends null for a dirty line whose text was cleared', async () => {
    await renderAndSave((items) => items.map((item) =>
      item.quote_item_id === 'item-b' ? { ...item, catalog_description: '   ', catalog_description_dirty: true } : item));

    expect(lastSavedItems('item-b').catalog_description).toBeNull();
    expect('catalog_description' in lastSavedItems('item-a')).toBe(false);
  });

  it('an untouched quote saves no catalog_description for any line', async () => {
    await renderAndSave((items) => items);

    expect('catalog_description' in lastSavedItems('item-a')).toBe(false);
    expect('catalog_description' in lastSavedItems('item-b')).toBe(false);
  });
});
