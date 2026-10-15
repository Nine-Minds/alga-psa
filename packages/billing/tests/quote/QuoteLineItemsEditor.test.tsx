// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${Number(value ?? 0).toFixed(2)}`,
    formatDate: (value: string) => String(value),
  }),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));

vi.mock('@alga-psa/billing/actions/unitOfMeasureActions', () => ({
  listTenantUnitsOfMeasure: vi.fn(async () => []),
  registerTenantUnitOfMeasure: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, onClick, disabled }: any) =>
    React.createElement('button', { id, onClick, disabled, type: 'button' }, children),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ value, ...props }: any) => React.createElement('input', { value: value ?? '', ...props }),
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange, disabled }: any) =>
    React.createElement('input', { id, type: 'checkbox', checked: Boolean(checked), onChange, disabled }),
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

vi.mock('@alga-psa/ui/components/UnitOfMeasureInput', () => ({
  UnitOfMeasureInput: () => null,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('../../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  default: () => null,
}));

import QuoteLineItemsEditor from '../../src/components/billing-dashboard/quotes/QuoteLineItemsEditor';
import type { DraftQuoteItem } from '../../src/components/billing-dashboard/quotes/quoteLineItemDraft';

const draftItem = (local_id: string, description: string, phase: string): DraftQuoteItem => ({
  local_id,
  description,
  phase,
  quantity: 1,
  unit_price: 10000,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  location_id: null,
});

const items = (): DraftQuoteItem[] => [
  draftItem('item-1', 'Managed Endpoint', 'Discovery'),
  draftItem('item-2', 'Onboarding', 'Rollout'),
];

/**
 * The editor is a controlled component: QuoteForm owns the draft items and
 * feeds them back through `items`. The section grouping is derived from
 * `phase`, so a committed phase re-keys (and remounts) the section the row
 * lives in — which is exactly what used to steal focus mid-word. Drive the
 * editor through a stateful parent so that feedback loop stays under test.
 */
const Harness: React.FC<{ onChange: (next: DraftQuoteItem[]) => void }> = ({ onChange }) => {
  const [draftItems, setDraftItems] = React.useState<DraftQuoteItem[]>(items);
  return (
    <QuoteLineItemsEditor
      items={draftItems}
      currencyCode="USD"
      onChange={(next) => {
        setDraftItems(next);
        onChange(next);
      }}
    />
  );
};

const phaseInput = (localId: string) =>
  document.getElementById(`quote-line-phase-${localId}`) as HTMLInputElement;

const rowFor = (localId: string) =>
  (document.getElementById(`quote-line-remove-${localId}`) as HTMLElement).closest('tr') as HTMLTableRowElement;

const dragHandleFor = (localId: string) =>
  rowFor(localId).querySelector('[draggable]') as HTMLElement;

describe('QuoteLineItemsEditor phase/section field', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps focus and typed spaces while editing, without committing per keystroke', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = phaseInput('item-1');
    input.focus();
    fireEvent.focus(input);
    expect(document.activeElement).toBe(input);

    for (const value of ['Discovery ', 'Discovery P', 'Discovery Ph', 'Discovery Pha']) {
      fireEvent.change(input, { target: { value } });
      // Same DOM node: the section must not re-key (and remount) mid-word.
      expect(phaseInput('item-1')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe(value);
    }

    // Backspacing is equally free-form while the field has focus.
    fireEvent.change(input, { target: { value: 'Discovery Ph' } });
    expect(phaseInput('item-1')).toBe(input);
    expect(input.value).toBe('Discovery Ph');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the trimmed phase once on blur, preserving interior spaces', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = phaseInput('item-1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  Discovery Phase 1  ' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DraftQuoteItem[];
    expect(next.find((item) => item.local_id === 'item-1')?.phase).toBe('Discovery Phase 1');
    expect(next.find((item) => item.local_id === 'item-2')?.phase).toBe('Rollout');
    expect(phaseInput('item-1').value).toBe('Discovery Phase 1');
  });

  it('commits on Enter and does not re-commit an unchanged value on blur', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = phaseInput('item-1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Discovery Phase 2 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DraftQuoteItem[];
    expect(next.find((item) => item.local_id === 'item-1')?.phase).toBe('Discovery Phase 2');

    const committedInput = phaseInput('item-1');
    expect(committedInput.value).toBe('Discovery Phase 2');
    fireEvent.blur(committedInput);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears the phase when the field is emptied', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = phaseInput('item-1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DraftQuoteItem[];
    expect(next.find((item) => item.local_id === 'item-1')?.phase).toBeNull();
  });
});

describe('QuoteLineItemsEditor row dragging', () => {
  afterEach(() => {
    cleanup();
  });

  it('drags from the handle only, leaving the row selectable', () => {
    render(<Harness onChange={vi.fn()} />);

    const row = rowFor('item-1');
    expect(row.hasAttribute('draggable')).toBe(false);

    const handle = dragHandleFor('item-1');
    expect(handle.getAttribute('draggable')).toBe('true');
    expect(handle.textContent).toContain('⋮⋮');
  });

  it('still reorders items when a dragged handle is dropped on another row', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const dataTransfer = { setData: vi.fn(), effectAllowed: 'uninitialized' };
    fireEvent.dragStart(dragHandleFor('item-2'), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'item-2');
    expect(dataTransfer.effectAllowed).toBe('move');

    fireEvent.drop(rowFor('item-1'), { dataTransfer });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DraftQuoteItem[];
    expect(next.map((item) => item.local_id)).toEqual(['item-2', 'item-1']);
    // Dropping into another section adopts that section's phase.
    expect(next[0].phase).toBe('Discovery');
  });
});
