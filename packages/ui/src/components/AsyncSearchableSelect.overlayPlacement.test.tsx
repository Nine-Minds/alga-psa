/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

const VIEWPORT = { width: 1024, height: 768 };

const loadOptions = async () => ({ options: [{ value: 'one', label: 'One result' }], total: 1 });

/** jsdom lays everything out at 0x0, so the trigger box under test is stubbed. */
const stubTriggerRect = (rect: { left: number; width: number; top: number; height: number }) => {
  const trigger = screen.getByRole('combobox');
  trigger.getBoundingClientRect = () =>
    ({
      left: rect.left,
      right: rect.left + rect.width,
      width: rect.width,
      top: rect.top,
      bottom: rect.top + rect.height,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return trigger;
};

const openPanel = async () => {
  fireEvent.click(screen.getByRole('combobox'));
  const search = await screen.findByPlaceholderText('Search...');
  return search.closest('[class*="z-["]') as HTMLElement;
};

describe('AsyncSearchableSelect overlay placement', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: VIEWPORT.width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: VIEWPORT.height, configurable: true });
  });

  it('widens a narrow trigger to overlayMinWidth and right-aligns instead of overflowing', async () => {
    render(
      <AsyncSearchableSelect
        id="min-width-select"
        value=""
        onChange={vi.fn()}
        loadOptions={loadOptions}
        dropdownMode="overlay"
        overlayMinWidth={300}
        debounceMs={0}
      />
    );
    // Narrow trigger hugging the right edge of the viewport.
    stubTriggerRect({ left: 900, width: 100, top: 100, height: 30 });
    const panel = await openPanel();

    expect(panel.style.width).toBe('300px');
    expect(panel.style.left).toBe('700px');
    expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(
      VIEWPORT.width - 16
    );
  });

  it('opens above the trigger when there is no room below', async () => {
    render(
      <AsyncSearchableSelect
        id="flip-select"
        value=""
        onChange={vi.fn()}
        loadOptions={loadOptions}
        dropdownMode="overlay"
        overlayFlip
        debounceMs={0}
      />
    );
    // Trigger sitting on the bottom edge of the viewport.
    stubTriggerRect({ left: 100, width: 200, top: 740, height: 30 });
    const panel = await openPanel();

    expect(panel.style.top).toBe('');
    expect(panel.style.bottom).toBe('32px');
    expect(screen.getByRole('listbox').style.maxHeight).toBe('320px');
  });

  it('caps the list at the space left below the trigger', async () => {
    render(
      <AsyncSearchableSelect
        id="short-space-select"
        value=""
        onChange={vi.fn()}
        loadOptions={loadOptions}
        dropdownMode="overlay"
        overlayFlip
        debounceMs={0}
      />
    );
    stubTriggerRect({ left: 100, width: 200, top: 470, height: 30 });
    const panel = await openPanel();

    expect(panel.style.top).toBe('504px');
    expect(panel.style.bottom).toBe('');
    const listMaxHeight = parseFloat(screen.getByRole('listbox').style.maxHeight);
    expect(listMaxHeight).toBeGreaterThan(150);
    expect(listMaxHeight).toBeLessThan(320);
  });

  it('leaves the opt-out overlay anchored below the trigger at the trigger width', async () => {
    render(
      <AsyncSearchableSelect
        id="default-overlay-select"
        value=""
        onChange={vi.fn()}
        loadOptions={loadOptions}
        dropdownMode="overlay"
        debounceMs={0}
      />
    );
    stubTriggerRect({ left: 900, width: 100, top: 740, height: 30 });
    const panel = await openPanel();

    expect(panel.style.width).toBe('100px');
    expect(panel.style.left).toBe('900px');
    expect(panel.style.top).toBe('774px');
    expect(panel.style.bottom).toBe('');
    expect(screen.getByRole('listbox').style.maxHeight).toBe('15rem');
  });
});
