/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AsyncSearchableSelect from './AsyncSearchableSelect';
import CustomSelect from './CustomSelect';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const zIndexOf = (element: Element | null) => {
  const match = element?.className.toString().match(/(?:^|\s)z-\[(\d+)\]/);
  if (!match) throw new Error('Expected element to declare an arbitrary z-index class');
  return Number(match[1]);
};

describe('AsyncSearchableSelect header filters', () => {
  it('renders a header CustomSelect menu above the overlay dropdown', async () => {
    render(
      <AsyncSearchableSelect
        id="layering-select"
        value=""
        onChange={vi.fn()}
        dropdownMode="overlay"
        debounceMs={0}
        loadOptions={async () => ({ options: [{ value: 'one', label: 'One result' }], total: 1 })}
        headerContent={
          <CustomSelect
            id="layering-category-filter"
            value="all"
            onValueChange={vi.fn()}
            options={[{ value: 'all', label: 'All categories' }, { value: 'backup', label: 'Cloud Backup' }]}
          />
        }
      />
    );

    const outerTrigger = document.querySelector('#layering-select > div > [role="combobox"]');
    if (!outerTrigger) throw new Error('Expected searchable select trigger');
    fireEvent.click(outerTrigger);
    const overlay = (await screen.findByText('One result')).closest('[class*="z-["]');

    const filterTrigger = document.getElementById('layering-category-filter');
    if (!filterTrigger) throw new Error('Expected category filter trigger');
    filterTrigger.focus();
    fireEvent.keyDown(filterTrigger, { key: 'Enter' });
    const menu = await waitFor(() => screen.getByRole('listbox'));

    expect(zIndexOf(menu)).toBeGreaterThan(zIndexOf(overlay));
  });
});
