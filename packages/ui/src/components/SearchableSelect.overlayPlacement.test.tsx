/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from './SearchableSelect';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'searchable-select' },
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

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function openAt(triggerRect: { top: number; bottom: number }, viewportHeight: number) {
  Object.defineProperty(window, 'innerHeight', { value: viewportHeight, configurable: true });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isTrigger = this.getAttribute('role') === 'combobox';
    const rect = isTrigger ? triggerRect : { top: 0, bottom: 0 };
    return { ...rect, left: 20, right: 320, width: 300, height: rect.bottom - rect.top, x: 20, y: rect.top, toJSON() {} } as DOMRect;
  });
  render(<SearchableSelect id="s" options={options} value="" onChange={() => {}} dropdownMode="overlay" label="Target" />);
  fireEvent.click(screen.getByRole('combobox'));
  return document.querySelector('.z-\\[99999\\]') as HTMLElement;
}

describe('SearchableSelect overlay placement', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens below the trigger when there is room', () => {
    const overlay = openAt({ top: 100, bottom: 140 }, 900);
    expect(overlay.style.top).toBe('144px');
    expect(overlay.style.transform).toBe('');
  });

  it('opens above the trigger when the list would run off the bottom of the viewport', () => {
    const overlay = openAt({ top: 600, bottom: 640 }, 700);
    expect(overlay.style.top).toBe('596px');
    expect(overlay.style.transform).toBe('translateY(-100%)');
  });
});
