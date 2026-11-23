// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftQuoteItem } from './quoteLineItemDraft';

const actionMocks = vi.hoisted(() => ({
  getServiceCatalogDescriptions: vi.fn(),
}));

vi.mock('../../../actions/serviceActions', () => ({
  getServiceCatalogDescriptions: (...args: unknown[]) => actionMocks.getServiceCatalogDescriptions(...args),
}));
vi.mock('@alga-psa/billing/actions/unitOfMeasureActions', () => ({
  listTenantUnitsOfMeasure: vi.fn(),
  registerTenantUnitOfMeasure: vi.fn(),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatCurrency: (v: number) => `$${v}` }),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, disabled, type }: any) => (
    <button id={id} type={type ?? 'button'} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange, label, disabled }: any) => (
    <label><input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />{label}</label>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
// Mirrors the real TextArea contract: label + id + value + onChange + disabled.
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, label, ...props }: any) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} {...props} />
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ content, children }: any) => <span data-tooltip={typeof content === 'string' ? content : undefined}>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/UnitOfMeasureInput', () => ({ UnitOfMeasureInput: () => <div /> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => <div /> }));
vi.mock('../contracts/ServiceCatalogPicker', () => ({ default: () => <div /> }));
vi.mock('../locations/LocationPicker', () => ({ default: () => <div /> }));
vi.mock('../locations/LocationAddress', () => ({ default: () => <div /> }));

import QuoteLineItemsEditor from './QuoteLineItemsEditor';

const PRODUCT_TEXT = 'Central management and monitoring.';

const line = (overrides: Partial<DraftQuoteItem> & { local_id: string }): DraftQuoteItem => ({
  description: overrides.local_id,
  quantity: 1,
  unit_price: 1000,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  ...overrides,
});

const catalogLine = (overrides: Partial<DraftQuoteItem> = {}) =>
  line({
    local_id: 'catalog-1',
    quote_item_id: 'catalog-1',
    service_id: 'svc-1',
    service_name: 'Firewall',
    catalog_description: PRODUCT_TEXT,
    ...overrides,
  });

const refreshButton = (localId = 'catalog-1') =>
  document.getElementById(`quote-line-product-description-refresh-${localId}`) as HTMLButtonElement | null;
const textArea = (localId = 'catalog-1') =>
  document.getElementById(`quote-line-product-description-${localId}`) as HTMLTextAreaElement | null;

const renderEditor = async (items: DraftQuoteItem[], props: { disabled?: boolean; onChange?: (items: DraftQuoteItem[]) => void } = {}) => {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <QuoteLineItemsEditor items={items} currencyCode="USD" disabled={props.disabled} onChange={onChange} />,
  );
  // Let the current-text lookup settle.
  await act(async () => { await Promise.resolve(); });
  return { ...utils, onChange };
};

describe('QuoteLineItemsEditor product description (alga-2026-0002804)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getServiceCatalogDescriptions.mockResolvedValue({ 'svc-1': PRODUCT_TEXT });
  });
  afterEach(() => cleanup());

  it('shows the TextArea only for catalog-backed lines, and read-only text for a deleted-product line', async () => {
    await renderEditor([
      catalogLine(),
      line({ local_id: 'custom-1', service_id: null, catalog_description: null }),
      line({ local_id: 'discount-1', is_discount: true, discount_type: 'percentage', discount_percentage: 10 }),
      line({ local_id: 'deleted-1', service_id: null, catalog_description: 'Frozen snapshot text' }),
    ]);

    expect(screen.getAllByText('Product description').length).toBeGreaterThan(0);
    expect(textArea('catalog-1')?.value).toBe(PRODUCT_TEXT);
    expect(textArea('custom-1')).toBeNull();
    expect(textArea('discount-1')).toBeNull();
    expect(textArea('deleted-1')).toBeNull();
    const readOnly = document.getElementById('quote-line-product-description-readonly-deleted-1');
    expect(readOnly?.textContent).toBe('Frozen snapshot text');
    expect(refreshButton('deleted-1')).toBeNull();
    // Only the one catalog-backed product is looked up.
    expect(actionMocks.getServiceCatalogDescriptions).toHaveBeenCalledWith(['svc-1']);
  });

  it('typing marks the line dirty and stores the text', async () => {
    const { onChange } = await renderEditor([catalogLine()]);

    fireEvent.change(textArea()!, { target: { value: 'Option wording' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = (onChange as any).mock.calls[0][0] as DraftQuoteItem[];
    expect(next).toMatchObject({ catalog_description: 'Option wording', catalog_description_dirty: true });
  });

  it('disables the refresh button with "Matches the product" when the text matches', async () => {
    await renderEditor([catalogLine()]);
    await waitFor(() => expect(actionMocks.getServiceCatalogDescriptions).toHaveBeenCalled());

    expect(refreshButton()?.disabled).toBe(true);
    expect(refreshButton()?.closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('Matches the product');
  });

  it('disables the refresh button with "Product no longer in the catalog" when the product is gone', async () => {
    actionMocks.getServiceCatalogDescriptions.mockResolvedValue({});
    await renderEditor([catalogLine({ catalog_description: 'Edited', catalog_description_edited: true })]);

    await waitFor(() => expect(refreshButton()?.closest('[data-tooltip]')?.getAttribute('data-tooltip'))
      .toBe('Product no longer in the catalog'));
    expect(refreshButton()?.disabled).toBe(true);
  });

  it('keeps the refresh button disabled while the current text is loading', async () => {
    let resolveLookup: (value: Record<string, string | null>) => void = () => {};
    actionMocks.getServiceCatalogDescriptions.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    await renderEditor([catalogLine({ catalog_description: 'Edited', catalog_description_edited: true })]);

    expect(refreshButton()?.disabled).toBe(true);
    expect(refreshButton()?.closest('[data-tooltip]')).toBeNull();

    await act(async () => { resolveLookup({ 'svc-1': PRODUCT_TEXT }); });
    await waitFor(() => expect(refreshButton()?.disabled).toBe(false));
  });

  it('hides the refresh button and locks the TextArea when the editor is disabled', async () => {
    await renderEditor(
      [catalogLine({ catalog_description: 'Edited', catalog_description_edited: true })],
      { disabled: true },
    );

    expect(refreshButton()).toBeNull();
    expect(textArea()?.disabled).toBe(true);
    expect(textArea()?.value).toBe('Edited');
  });

  it('clicking refresh fills the current product text and marks the line dirty, so the normal save carries it', async () => {
    const { onChange } = await renderEditor([
      catalogLine({ catalog_description: 'Edited wording', catalog_description_edited: true }),
    ]);
    await waitFor(() => expect(refreshButton()?.disabled).toBe(false));

    fireEvent.click(refreshButton()!);

    const [next] = (onChange as any).mock.calls[0][0] as DraftQuoteItem[];
    expect(next).toMatchObject({ catalog_description: PRODUCT_TEXT, catalog_description_dirty: true });
  });

  it('shows the "Edited for this quote" caption only for a diverged, edited line', async () => {
    const caption = (id = 'catalog-1') => document.getElementById(`quote-line-product-description-edited-${id}`);

    // Flagged by the server and different from the product: caption.
    const flagged = await renderEditor([catalogLine({ catalog_description: 'Edited wording', catalog_description_edited: true })]);
    await waitFor(() => expect(caption()).not.toBeNull());
    expect(caption()?.textContent).toBe('Edited for this quote');
    flagged.unmount();

    // Dirty in this session and different: caption.
    const dirty = await renderEditor([catalogLine({ catalog_description: 'Typed', catalog_description_dirty: true })]);
    await waitFor(() => expect(caption()).not.toBeNull());
    dirty.unmount();

    // Flagged but matches the product again: no caption.
    const matching = await renderEditor([catalogLine({ catalog_description_edited: true })]);
    expect(caption()).toBeNull();
    matching.unmount();

    // Differs from the product only because the product changed later (not flagged, not dirty): no caption.
    await renderEditor([catalogLine({ catalog_description: 'Old snapshot text' })]);
    expect(caption()).toBeNull();
  });

  describe('lookup in flight while the quote lines change', () => {
    type Lookup = { ids: string[]; resolve: (value: Record<string, string | null>) => void };
    const deferLookups = () => {
      const lookups: Lookup[] = [];
      actionMocks.getServiceCatalogDescriptions.mockImplementation((ids: string[]) =>
        new Promise((resolve) => { lookups.push({ ids, resolve }); }));
      return lookups;
    };
    const caption = (id = 'catalog-1') => document.getElementById(`quote-line-product-description-edited-${id}`);
    const rerenderEditor = (utils: ReturnType<typeof render>, items: DraftQuoteItem[]) =>
      utils.rerender(<QuoteLineItemsEditor items={items} currencyCode="USD" onChange={vi.fn()} />);

    it('keeps the result when the lines are re-rendered (quantity edited) before the lookup resolves', async () => {
      const lookups = deferLookups();
      const original = catalogLine({ catalog_description: 'Edited wording', catalog_description_edited: true });
      const utils = await renderEditor([original]);

      rerenderEditor(utils, [{ ...original, quantity: 5 }]);
      await act(async () => { await Promise.resolve(); });

      await act(async () => { lookups.forEach((l) => l.resolve({ 'svc-1': PRODUCT_TEXT })); });

      await waitFor(() => expect(refreshButton()?.disabled).toBe(false));
      expect(caption()?.textContent).toBe('Edited for this quote');
    });

    it('loads every id when a product line is added before the first lookup resolves', async () => {
      const lookups = deferLookups();
      const original = catalogLine({ catalog_description: 'Edited wording', catalog_description_edited: true });
      const utils = await renderEditor([original]);

      const added = catalogLine({
        local_id: 'catalog-2', quote_item_id: 'catalog-2', service_id: 'svc-2', service_name: 'Switch',
        catalog_description: 'Edited switch', catalog_description_edited: true,
      });
      const gone = catalogLine({
        local_id: 'catalog-3', quote_item_id: 'catalog-3', service_id: 'svc-3', service_name: 'Retired',
        catalog_description: 'Edited retired', catalog_description_edited: true,
      });
      rerenderEditor(utils, [original, added, gone]);
      await act(async () => { await Promise.resolve(); });

      // Every id has been asked for by some lookup; none is stuck un-requested.
      const requested = new Set(lookups.flatMap((l) => l.ids));
      expect(requested).toEqual(new Set(['svc-1', 'svc-2', 'svc-3']));

      // The mock omits svc-3 (product gone).
      await act(async () => {
        lookups.forEach((l) => l.resolve(Object.fromEntries(
          l.ids.filter((id) => id !== 'svc-3').map((id) => [id, id === 'svc-1' ? PRODUCT_TEXT : 'Switch text']),
        )));
      });

      await waitFor(() => expect(refreshButton('catalog-1')?.disabled).toBe(false));
      await waitFor(() => expect(refreshButton('catalog-2')?.disabled).toBe(false));
      expect(caption('catalog-1')).not.toBeNull();
      expect(caption('catalog-2')).not.toBeNull();
      expect(refreshButton('catalog-3')?.closest('[data-tooltip]')?.getAttribute('data-tooltip'))
        .toBe('Product no longer in the catalog');
    });
  });
});
