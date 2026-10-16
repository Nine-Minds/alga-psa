/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AsyncSearchableSelect from './AsyncSearchableSelect';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'async-searchable-select' },
    updateMetadata: vi.fn(),
  }),
}));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

describe('AsyncSearchableSelect secondaryLabel', () => {
  it('renders the optional secondary line under the label and keeps label-only rows working', async () => {
    render(
      <AsyncSearchableSelect
        id="picker"
        value=""
        onChange={vi.fn()}
        debounceMs={0}
        loadOptions={async () => ({
          options: [
            { value: 'p1', label: 'Grandstream IP Phone (RTR-1)', secondaryLabel: 'Grandstream GRP2614' },
            { value: 'p2', label: 'Plain Service' },
          ],
          total: 2,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Grandstream IP Phone (RTR-1)')).toBeTruthy();
    expect(screen.getByText('Grandstream GRP2614')).toBeTruthy();
    expect(screen.getByText('Plain Service')).toBeTruthy();
  });
});
