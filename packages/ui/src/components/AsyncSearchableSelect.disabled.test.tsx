/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AsyncSearchableSelect from './AsyncSearchableSelect';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
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

describe('AsyncSearchableSelect disabled options', () => {
  const loadOptions = async () => ({
    options: [{ value: 'blocked', label: 'Blocked result', disabled: true }],
    total: 1,
  });

  it('does not select a disabled option by click', async () => {
    const onChange = vi.fn();
    render(<AsyncSearchableSelect id="disabled-click" value="" onChange={onChange} loadOptions={loadOptions} debounceMs={0} />);
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByText('Blocked result');
    fireEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not select a disabled option with Enter', async () => {
    const onChange = vi.fn();
    render(<AsyncSearchableSelect id="disabled-enter" value="" onChange={onChange} loadOptions={loadOptions} debounceMs={0} />);
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByText('Blocked result');
    await waitFor(() => expect(option.closest('[aria-disabled="true"]')).not.toBeNull());
    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
