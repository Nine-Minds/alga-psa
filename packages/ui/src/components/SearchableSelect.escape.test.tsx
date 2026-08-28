/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from './SearchableSelect';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'searchable-select' },
    updateMetadata: vi.fn(),
  }),
}));

// cmdk observes its list and scrolls the active item; jsdom has neither API.
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
  { value: 'user-1', label: 'Morgan Chen' },
  { value: 'user-2', label: 'Dorothy Gale' },
];

function renderSelect() {
  const onChange = vi.fn();
  render(
    <SearchableSelect id="user-hours-selector" options={options} value="" onChange={onChange} label="Technician" />,
  );
  return { onChange };
}

// Radix dismissable layers (Dialog/Drawer) listen for Escape on the document in
// the capture phase; this stands in for the surrounding dialog.
function spyOnSurroundingLayer() {
  const layer = vi.fn();
  const handler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') layer();
  };
  document.addEventListener('keydown', handler, { capture: true });
  return { layer, dispose: () => document.removeEventListener('keydown', handler, { capture: true }) };
}

describe('SearchableSelect escape ownership', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    while (disposers.length) {
      const dispose = disposers.pop();
      dispose?.();
    }
  });

  it('closes only the dropdown, leaving the surrounding dialog open', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const outer = spyOnSurroundingLayer();
    disposers.push(outer.dispose);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(outer.layer).not.toHaveBeenCalled();
  });

  it('lets the surrounding dialog own escape once the dropdown is closed', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    const outer = spyOnSurroundingLayer();
    disposers.push(outer.dispose);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(outer.layer).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the trigger so keyboard users stay in place', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(document.activeElement).toBe(trigger);
  });

  it('leaves other keys to the surrounding dialog while open', () => {
    renderSelect();
    fireEvent.click(screen.getByRole('combobox'));

    const outer = vi.fn();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Enter') outer(); };
    document.addEventListener('keydown', handler, { capture: true });
    disposers.push(() => document.removeEventListener('keydown', handler, { capture: true }));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });

    expect(outer).toHaveBeenCalledTimes(1);
  });
});
