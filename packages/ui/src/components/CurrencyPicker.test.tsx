/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CurrencyPicker } from './CurrencyPicker';

// jsdom lacks ResizeObserver and scrollIntoView, which cmdk's list needs to render.
if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// configurable: the whole unit suite shares one fork, and later suites redefine this.
if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
}

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'currency-picker' },
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function openDropdown() {
  fireEvent.click(screen.getByRole('combobox'));
  return screen.getByPlaceholderText('Search...');
}

describe('CurrencyPicker', () => {
  afterEach(cleanup);

  it('renders the search box as the first row of the dropdown and focuses it', () => {
    render(<CurrencyPicker id="currency" value="USD" onValueChange={vi.fn()} />);

    expect(screen.queryByPlaceholderText('Search...')).toBeNull();

    const search = openDropdown();
    expect(document.activeElement).toBe(search);
    expect(search.compareDocumentPosition(screen.getByRole('listbox')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('defaults to the shared currency list and filters it as the user types', () => {
    render(<CurrencyPicker id="currency" value="USD" onValueChange={vi.fn()} />);

    const search = openDropdown();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('USD ($)')).toBeTruthy();
    expect(within(list).getByText('EUR (€)')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'eur' } });

    expect(within(list).getByText('EUR (€)')).toBeTruthy();
    expect(within(list).queryByText('USD ($)')).toBeNull();
  });

  it('fires onValueChange with the currency code when an option is picked', () => {
    const onValueChange = vi.fn();
    render(<CurrencyPicker id="currency" value="USD" onValueChange={onValueChange} />);

    const search = openDropdown();
    fireEvent.change(search, { target: { value: 'jpy' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByText('JPY (¥)'));

    expect(onValueChange).toHaveBeenCalledWith('JPY');
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
  });

  it('closes only the dropdown on Escape, leaving the surrounding dialog open', () => {
    // Radix dialogs/drawers listen for Escape on document in the capture phase.
    const dialogEscape = vi.fn();
    document.addEventListener('keydown', dialogEscape, true);

    try {
      render(<CurrencyPicker id="currency" value="USD" onValueChange={vi.fn()} />);

      const search = openDropdown();
      fireEvent.keyDown(search, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('Search...')).toBeNull();
      expect(dialogEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', dialogEscape, true);
    }
  });

  it('respects an options override', () => {
    render(
      <CurrencyPicker
        id="currency"
        value=""
        onValueChange={vi.fn()}
        options={[
          { value: '__INVOICE_CURRENCY__', label: 'Use invoice currency' },
          { value: 'GBP', label: 'GBP (£)' },
        ]}
      />
    );

    openDropdown();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Use invoice currency')).toBeTruthy();
    expect(within(list).getByText('GBP (£)')).toBeTruthy();
    expect(within(list).queryByText('USD ($)')).toBeNull();
  });
});
