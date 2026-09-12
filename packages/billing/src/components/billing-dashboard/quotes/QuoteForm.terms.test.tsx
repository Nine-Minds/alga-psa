// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartialBlock } from '@blocknote/core';

const editorMounts: Array<{ initialContent: unknown; mountedAt: number }> = [];
let editorMountSeq = 0;
let latestOnChange: ((blocks: PartialBlock[]) => void) | null = null;

const actionMocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  createQuoteFromTemplate: vi.fn(),
  updateQuote: vi.fn(),
  getQuote: vi.fn(),
  getQuoteDocumentTemplates: vi.fn(),
  getQuoteApprovalSettings: vi.fn(),
  listQuotes: vi.fn(),
  getAllClientsForBilling: vi.fn(),
  getActiveClientLocationsForBilling: vi.fn(),
  getContactsForPicker: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ initialContent, onContentChange }: { initialContent?: PartialBlock[]; onContentChange?: (blocks: PartialBlock[]) => void }) => {
    useEffect(() => {
      editorMountSeq += 1;
      editorMounts.push({ initialContent, mountedAt: editorMountSeq });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    latestOnChange = onContentChange ?? null;
    return (
      <div>
        <pre data-testid="quote-terms-editor-content">{JSON.stringify(initialContent)}</pre>
        <button type="button" data-testid="quote-terms-editor-edit" onClick={() => onContentChange?.([{ type: 'paragraph', content: [{ type: 'text', text: 'Edited visible terms' }] }] as PartialBlock[])}>
          edit
        </button>
      </div>
    );
  },
  QuoteTermsContent: ({ block, text }: { block?: unknown; text?: string | null }) => (
    <div data-testid="quote-terms-readonly-content">{JSON.stringify(block ?? text)}</div>
  ),
}));

vi.mock('../../../actions/quoteActions', () => ({
  createQuote: (...args: unknown[]) => actionMocks.createQuote(...args),
  createQuoteFromTemplate: (...args: unknown[]) => actionMocks.createQuoteFromTemplate(...args),
  updateQuote: (...args: unknown[]) => actionMocks.updateQuote(...args),
  getQuote: (...args: unknown[]) => actionMocks.getQuote(...args),
  getQuoteApprovalSettings: (...args: unknown[]) => actionMocks.getQuoteApprovalSettings(...args),
  listQuotes: (...args: unknown[]) => actionMocks.listQuotes(...args),
  addQuoteItem: vi.fn(),
  approveQuote: vi.fn(),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  convertQuoteToSalesOrder: vi.fn(),
  createQuoteRevision: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  removeQuoteItem: vi.fn(),
  reorderQuoteItems: vi.fn(),
  requestQuoteApprovalChanges: vi.fn(),
  resendQuote: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
  submitQuoteForApproval: vi.fn(),
  updateQuoteItem: vi.fn(),
}));

vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: (...args: unknown[]) => actionMocks.getQuoteDocumentTemplates(...args),
}));
vi.mock('../../../actions/billingClientsActions', () => ({
  getAllClientsForBilling: (...args: unknown[]) => actionMocks.getAllClientsForBilling(...args),
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
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: (props: any) => <input data-testid={props.id} />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select id={id} value={value ?? ''} onChange={(event) => onValueChange?.(event.target.value)}>
      <option value="">{placeholder}</option>
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({
  default: () => <div data-testid="currency-picker" />,
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => <div data-testid="contact-picker" />,
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: () => <div data-testid="loading" />,
}));
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
vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));
vi.mock('./QuoteLineItemsEditor', () => ({ default: () => <div data-testid="line-items-editor" /> }));
vi.mock('./QuoteSendRecipientsField', () => ({
  QuoteSendRecipientsField: () => <div data-testid="send-recipients" />,
}));
vi.mock('./QuoteStatusBadge', () => ({ default: () => <div data-testid="status-badge" /> }));

import QuoteForm from './QuoteForm';

const RICH_TEMPLATE_BLOCK: PartialBlock[] = [
  { type: 'paragraph', content: [{ type: 'text', text: 'Template rich terms', styles: {} }] },
];

const RICH_TEMPLATE = {
  quote_id: 'template-1',
  title: 'Rich Terms Template',
  terms_and_conditions: 'Template rich terms',
  terms_and_conditions_block: RICH_TEMPLATE_BLOCK,
  quote_items: [],
  currency_code: 'USD',
};

describe('QuoteForm terms authoring', () => {
  beforeEach(() => {
    editorMounts.length = 0;
    editorMountSeq = 0;
    latestOnChange = null;
    vi.clearAllMocks();

    actionMocks.getDefaultBillingSettings.mockResolvedValue({ default_currency_code: 'USD' });
    actionMocks.getAllClientsForBilling.mockResolvedValue([]);
    actionMocks.getContactsForPicker.mockResolvedValue([]);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getQuoteDocumentTemplates.mockResolvedValue([]);
    actionMocks.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    actionMocks.listQuotes.mockResolvedValue({ data: [RICH_TEMPLATE], total: 1, page: 1, pageSize: 200, totalPages: 1 });
    actionMocks.getQuote.mockResolvedValue(RICH_TEMPLATE);
    actionMocks.createQuoteFromTemplate.mockResolvedValue({ quote_id: 'quote-new', quote_number: 'Q-100', quote_items: [] });
    actionMocks.createQuote.mockResolvedValue({ quote_id: 'quote-new', quote_number: 'Q-100', quote_items: [] });
    actionMocks.updateQuote.mockResolvedValue({ quote_id: 'quote-1', quote_number: 'Q-001', quote_items: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('T019/T020: selecting a rich template after mount shows its terms, and edits save instead of being clobbered', async () => {
    render(
      <QuoteForm
        quoteId={null}
        initialIsTemplate={false}
        initialContext={{ clientId: 'client-1' }}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(document.getElementById('quote-form-template-picker')).toBeTruthy());
    // The editor mounted once with the empty default before a template is chosen.
    expect(editorMounts.length).toBe(1);

    fireEvent.change(document.getElementById('quote-form-template-picker') as HTMLSelectElement, {
      target: { value: 'template-1' },
    });

    // Choosing the template replaces the editor document (remount) with the
    // template's rich terms rather than leaving the stale empty document.
    await waitFor(() => expect(editorMounts.length).toBe(2));
    expect(editorMounts[1].initialContent).toEqual(RICH_TEMPLATE_BLOCK);
    expect(screen.getByTestId('quote-terms-editor-content').textContent).toContain('Template rich terms');

    // Editing the visible terms must not remount the editor.
    fireEvent.click(screen.getByTestId('quote-terms-editor-edit'));
    expect(editorMounts.length).toBe(2);

    fireEvent.click(document.getElementById('quote-form-save') as HTMLButtonElement);

    await waitFor(() => expect(actionMocks.createQuoteFromTemplate).toHaveBeenCalled());
    const [, payload] = actionMocks.createQuoteFromTemplate.mock.calls[0];
    expect(payload.terms_and_conditions_block).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Edited visible terms' }] },
    ]);
  });

  it('T019: reopening a saved rich quote seeds the editor from the stored block', async () => {
    render(
      <QuoteForm
        quoteId="quote-1"
        initialIsTemplate={false}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(editorMounts.length).toBeGreaterThan(0));
    expect(editorMounts[editorMounts.length - 1].initialContent).toEqual(RICH_TEMPLATE_BLOCK);
  });
});
