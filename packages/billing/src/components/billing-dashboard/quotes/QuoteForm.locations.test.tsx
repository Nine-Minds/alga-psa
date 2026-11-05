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
  addQuoteItem: vi.fn(),
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
  updateQuoteItem: vi.fn(),
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
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: (props: any) => <input id={props.id} type="date" value={props.value ? props.value.toISOString().slice(0, 10) : ''} onChange={(event) => props.onChange?.(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)} />,
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
  ClientPicker: ({ id, onSelect }: any) => (
    <div data-testid="client-picker">
      <button id={`${id}-pick-client-1`} onClick={() => onSelect('client-1')}>client one</button>
      <button id={`${id}-pick-client-2`} onClick={() => onSelect('client-2')}>client two</button>
    </div>
  ),
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
// Each option is a button that confirms with that choice, so a test picks
// "move" or "delete" exactly the way the radio + confirm pair does.
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ id, isOpen, title, message, options, onConfirm, onClose }: any) => (
    isOpen ? (
      <div id={id}>
        <div data-testid="location-remove-title">{title}</div>
        <div data-testid="location-remove-message">{message}</div>
        {(options ?? []).map((option: any) => (
          <button key={option.value} id={`${id}-option-${option.value}`} onClick={() => onConfirm(option.value)}>
            {option.label}
          </button>
        ))}
        <button id={`${id}-dismiss`} onClick={onClose}>dismiss</button>
      </div>
    ) : null
  ),
}));
vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));
vi.mock('./QuoteSendRecipientsField', () => ({
  QuoteSendRecipientsField: () => <div data-testid="send-recipients" />,
}));
vi.mock('./QuoteStatusBadge', () => ({ default: () => <div data-testid="status-badge" /> }));

type EditorProps = {
  items: DraftQuoteItem[];
  onChange: (items: DraftQuoteItem[]) => void;
  locations?: Array<{ location_id: string }>;
  extraGroupLocationIds?: string[];
  onAddLocationGroup?: () => void;
  onRemoveLocationGroup?: (locationId: string | null, source: 'user' | 'empty-group') => void;
};

let editorProps: EditorProps | null = null;

vi.mock('./QuoteLineItemsEditor', () => ({
  default: (props: EditorProps) => {
    editorProps = props;
    return <div data-testid="line-items-editor" />;
  },
}));

import QuoteForm from './QuoteForm';

const location = (id: string, clientId: string, name: string, isDefault = false) => ({
  location_id: id,
  client_id: clientId,
  location_name: name,
  address_line1: `${name} street`,
  address_line2: null,
  address_line3: null,
  city: 'Springfield',
  state_province: 'IL',
  postal_code: '62701',
  country_code: 'US',
  country_name: 'United States',
  region_code: null,
  is_active: true,
  is_default: isDefault,
  is_billing_address: isDefault,
  is_shipping_address: false,
  phone: null,
  fax: null,
  email: null,
});

const CLIENT_1_LOCATIONS = [location('loc-a', 'client-1', 'Site A', true), location('loc-b', 'client-1', 'Site B')];
const CLIENT_2_LOCATIONS = [location('loc-c', 'client-2', 'Site C', true), location('loc-d', 'client-2', 'Site D')];

const draft = (overrides: Partial<DraftQuoteItem> & { local_id: string }): DraftQuoteItem => ({
  description: overrides.local_id,
  quantity: 1,
  unit_price: 1000,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  ...overrides,
});

const TEMPLATE_WITH_LOCATIONS = {
  quote_id: 'template-1',
  title: 'Multi-site template',
  currency_code: 'USD',
  quote_items: [
    {
      quote_item_id: 'tmpl-item-1',
      quote_id: 'template-1',
      description: 'Managed endpoints',
      quantity: 2,
      unit_price: 2500,
      total_price: 5000,
      net_amount: 5000,
      tax_amount: 0,
      display_order: 0,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      // Belongs to whichever client the template was authored for.
      location_id: 'loc-foreign',
    },
    {
      quote_item_id: 'tmpl-item-2',
      quote_id: 'template-1',
      description: 'Loyalty discount',
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      net_amount: 0,
      tax_amount: 0,
      display_order: 1,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      applies_to_item_id: 'tmpl-item-1',
      location_id: 'loc-foreign',
    },
  ],
};

const renderForm = async () => {
  const utils = render(
    <QuoteForm
      quoteId={null}
      initialContext={{ clientId: 'client-1' }}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await waitFor(() => expect(editorProps).not.toBeNull());
  await waitFor(() => expect(actionMocks.getActiveClientLocationsForBilling).toHaveBeenCalledWith('client-1'));
  return utils;
};

const setItems = async (items: DraftQuoteItem[]) => {
  await act(async () => {
    editorProps!.onChange(items);
  });
};

const currentItems = () => editorProps!.items;

describe('QuoteForm multi-location editing (alga-2026-0002902)', () => {
  beforeEach(() => {
    editorProps = null;
    vi.clearAllMocks();

    actionMocks.getDefaultBillingSettings.mockResolvedValue({ defaultCurrencyCode: 'USD' });
    actionMocks.getClientByIdForBilling.mockResolvedValue(null);
    actionMocks.getContactsForPicker.mockResolvedValue([]);
    actionMocks.getActiveClientLocationsForBilling.mockImplementation(async (clientId: string) =>
      (clientId === 'client-2' ? CLIENT_2_LOCATIONS : CLIENT_1_LOCATIONS));
    actionMocks.getQuoteDocumentTemplates.mockResolvedValue([]);
    actionMocks.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    actionMocks.listQuotes.mockResolvedValue({ data: [TEMPLATE_WITH_LOCATIONS], total: 1, page: 1, pageSize: 200, totalPages: 1 });
    actionMocks.getQuote.mockResolvedValue(TEMPLATE_WITH_LOCATIONS);
    actionMocks.createQuoteFromTemplate.mockResolvedValue({ quote_id: 'quote-new', quote_number: 'Q-100', quote_items: [] });
    actionMocks.createQuote.mockResolvedValue({ quote_id: 'quote-new', quote_number: 'Q-100', quote_items: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('clears foreign locations on a client change and re-stamps the new client primary', async () => {
    await renderForm();
    await setItems([
      draft({ local_id: 'item-1', location_id: 'loc-a' }),
      draft({ local_id: 'item-2', location_id: 'loc-b' }),
    ]);

    await act(async () => {
      (document.getElementById('quote-client-pick-client-2') as HTMLButtonElement).click();
    });

    await waitFor(() => expect(actionMocks.getActiveClientLocationsForBilling).toHaveBeenCalledWith('client-2'));
    await waitFor(() => {
      expect(currentItems().map((item) => item.location_id)).toEqual(['loc-c', 'loc-c']);
    });
  });

  it('never assigns a location to a discount line', async () => {
    await renderForm();
    await setItems([
      draft({ local_id: 'item-1' }),
      draft({ local_id: 'discount-1', is_discount: true, discount_type: 'percentage', discount_percentage: 10 }),
    ]);

    await waitFor(() => expect(currentItems()[0].location_id).toBe('loc-a'));
    expect(currentItems()[1].location_id).toBeFalsy();
  });

  it('moves a removed location group to the default group when the user chooses move', async () => {
    await renderForm();
    await setItems([
      draft({ local_id: 'item-1', location_id: 'loc-a' }),
      draft({ local_id: 'item-2', location_id: 'loc-b' }),
    ]);

    await act(async () => {
      editorProps!.onRemoveLocationGroup?.('loc-b', 'user');
    });

    const dialog = document.getElementById('quote-location-remove-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('Site A');

    await act(async () => {
      (document.getElementById('quote-location-remove-dialog-option-move') as HTMLButtonElement).click();
    });

    expect(currentItems().map((item) => item.local_id)).toEqual(['item-1', 'item-2']);
    expect(currentItems().map((item) => item.location_id)).toEqual(['loc-a', 'loc-a']);
    expect(document.getElementById('quote-location-remove-dialog')).toBeNull();
  });

  it('deletes the group items only when the user explicitly chooses delete', async () => {
    await renderForm();
    await setItems([
      draft({ local_id: 'item-1', location_id: 'loc-a' }),
      draft({ local_id: 'item-2', location_id: 'loc-b' }),
    ]);

    await act(async () => {
      editorProps!.onRemoveLocationGroup?.('loc-b', 'user');
    });
    await act(async () => {
      (document.getElementById('quote-location-remove-dialog-option-delete') as HTMLButtonElement).click();
    });

    expect(currentItems().map((item) => item.local_id)).toEqual(['item-1']);
  });

  it('keeps the dialog shut when the editor reports an emptied group', async () => {
    await renderForm();
    await setItems([draft({ local_id: 'item-1', location_id: 'loc-a' })]);

    await act(async () => {
      editorProps!.onRemoveLocationGroup?.('loc-b', 'empty-group');
    });

    expect(document.getElementById('quote-location-remove-dialog')).toBeNull();
    expect(currentItems().map((item) => item.local_id)).toEqual(['item-1']);
  });

  it('ignores "+ Add location" while the new client\'s locations are still loading', async () => {
    let releaseClient2Locations: (() => void) | null = null;
    actionMocks.getActiveClientLocationsForBilling.mockImplementation(async (clientId: string) => {
      if (clientId !== 'client-2') return CLIENT_1_LOCATIONS;
      await new Promise<void>((resolve) => { releaseClient2Locations = resolve; });
      return CLIENT_2_LOCATIONS;
    });

    await renderForm();
    await setItems([
      draft({ local_id: 'item-1', location_id: 'loc-a' }),
      draft({ local_id: 'item-2', location_id: 'loc-b' }),
    ]);

    await act(async () => {
      (document.getElementById('quote-client-pick-client-2') as HTMLButtonElement).click();
    });

    // Mid-switch the editor is offered no locations at all, so its own
    // "+ Add location" is disabled; the handler refuses too.
    expect(editorProps!.locations).toEqual([]);
    await act(async () => {
      editorProps!.onAddLocationGroup?.();
    });
    expect(currentItems().every((item) => !item.location_id)).toBe(true);
    expect(editorProps!.extraGroupLocationIds ?? []).toEqual([]);

    await act(async () => {
      releaseClient2Locations?.();
    });
    await waitFor(() => {
      expect(currentItems().map((item) => item.location_id)).toEqual(['loc-c', 'loc-c']);
    });
  });

  it('discards a previous client location re-stamped during the switch window', async () => {
    let releaseClient2Locations: (() => void) | null = null;
    actionMocks.getActiveClientLocationsForBilling.mockImplementation(async (clientId: string) => {
      if (clientId !== 'client-2') return CLIENT_1_LOCATIONS;
      await new Promise<void>((resolve) => { releaseClient2Locations = resolve; });
      return CLIENT_2_LOCATIONS;
    });

    await renderForm();
    await setItems([draft({ local_id: 'item-1', location_id: 'loc-a' })]);

    await act(async () => {
      (document.getElementById('quote-client-pick-client-2') as HTMLButtonElement).click();
    });

    // Stand in for any edit landing inside the lookup window that re-applies
    // the old client's site (a drag, a stale group header, a queued click).
    await setItems([
      draft({ local_id: 'item-1', location_id: 'loc-a' }),
      draft({ local_id: 'discount-1', is_discount: true, location_id: 'loc-b' }),
    ]);

    await act(async () => {
      releaseClient2Locations?.();
    });

    await waitFor(() => {
      expect(currentItems().map((item) => item.location_id)).toEqual(['loc-c', null]);
    });
  });

  it('offers the freed primary location when the only group was re-pointed', async () => {
    await renderForm();
    // The single group was switched from the primary (loc-a) to loc-b, so
    // loc-a is free again and must be what "+ Add location" seeds.
    await setItems([draft({ local_id: 'item-1', location_id: 'loc-b' })]);

    await act(async () => {
      editorProps!.onAddLocationGroup?.();
    });

    await waitFor(() => expect(editorProps!.extraGroupLocationIds).toEqual(['loc-a']));
    expect(currentItems().map((item) => item.location_id)).toEqual(['loc-b']);
  });

  it('sends the current drafts — locations and remapped discount targets — to createQuoteFromTemplate', async () => {
    await renderForm();

    await act(async () => {
      const picker = document.getElementById('quote-form-template-picker') as HTMLSelectElement;
      picker.value = 'template-1';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The template's own (foreign) location is dropped and the client's
    // primary is stamped on the base row; the discount stays unsited.
    await waitFor(() => expect(currentItems().length).toBe(2));
    await waitFor(() => expect(currentItems()[0].location_id).toBe('loc-a'));

    await act(async () => {
      (document.getElementById('quote-form-save') as HTMLButtonElement).click();
    });

    await waitFor(() => expect(actionMocks.createQuoteFromTemplate).toHaveBeenCalled());
    const [templateId, payload] = actionMocks.createQuoteFromTemplate.mock.calls[0];
    expect(templateId).toBe('template-1');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ description: 'Managed endpoints', location_id: 'loc-a' });
    expect(payload.items[1]).toMatchObject({ is_discount: true, location_id: null });
    // Targets the draft's local id, not the template's quote_item_id.
    expect(payload.items[1].applies_to_item_id).toBe(payload.items[0].local_id);
    expect(payload.items[1].applies_to_item_id).not.toBe('tmpl-item-1');
  });
});
