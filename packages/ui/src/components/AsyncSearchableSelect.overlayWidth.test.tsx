/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const rect = (left: number, width: number): DOMRect =>
  ({ left, width, right: left + width, top: 100, bottom: 134, height: 34, x: left, y: 100, toJSON: () => ({}) }) as DOMRect;

async function openWithTriggerAt(left: number, width: number) {
  render(
    <AsyncSearchableSelect
      id="overlay-width-select"
      value=""
      onChange={vi.fn()}
      dropdownMode="overlay"
      loadOptions={async () => ({ options: [{ value: 'one', label: 'CF3195 Beta Logistics' }], total: 1 })}
      debounceMs={0}
    />,
  );
  const trigger = screen.getByRole('combobox');
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(left, width));
  fireEvent.click(trigger);
  const option = await screen.findByText('CF3195 Beta Logistics');
  // The positioned overlay is the portal node that carries the inline geometry.
  let node: HTMLElement | null = option;
  while (node && !node.style.width) node = node.parentElement;
  return node!;
}

describe('AsyncSearchableSelect overlay width', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the list at least 18rem wide under a narrow, content-sized trigger', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    const overlay = await openWithTriggerAt(470, 120);
    expect(overlay.style.width).toBe('288px');
    expect(overlay.style.left).toBe('470px');
  });

  it('matches a trigger that is already wider than the minimum', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    const overlay = await openWithTriggerAt(200, 400);
    expect(overlay.style.width).toBe('400px');
    expect(overlay.style.left).toBe('200px');
  });

  it('shifts a widened list left so it stays inside the viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    const overlay = await openWithTriggerAt(900, 90);
    expect(overlay.style.width).toBe('288px');
    expect(overlay.style.left).toBe(`${1000 - 288 - 8}px`);
  });
});
