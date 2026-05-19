/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShortcutCatalogEntry } from './catalog';
import { KeyboardShortcutsProvider, useShortcutAction } from './provider';
import type { ShortcutAction } from './types';

afterEach(() => {
  cleanup();
});

function navigationAction(id: 'navigation.goTickets' | 'navigation.goAssets' | 'navigation.goClients', handler: ShortcutAction['handler']): ShortcutAction {
  const entry = getShortcutCatalogEntry(id);
  if (!entry) {
    throw new Error(`Missing catalog entry for ${id}`);
  }

  return {
    ...entry,
    handler,
  };
}

function Action({ action }: { action: ShortcutAction }) {
  useShortcutAction(action);
  return null;
}

function dispatchShortcut(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });

  target.dispatchEvent(event);
  return event;
}

describe('navigation shortcut actions', () => {
  it('dispatches catalogued g-sequences for tickets, assets, and clients', () => {
    const goTickets = vi.fn();
    const goAssets = vi.fn();
    const goClients = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={navigationAction('navigation.goTickets', goTickets)} />
        <Action action={navigationAction('navigation.goAssets', goAssets)} />
        <Action action={navigationAction('navigation.goClients', goClients)} />
      </KeyboardShortcutsProvider>,
    );

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(true);
    expect(goTickets).toHaveBeenCalledTimes(1);

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    expect(dispatchShortcut(document, { key: 'a', code: 'KeyA' }).defaultPrevented).toBe(true);
    expect(goAssets).toHaveBeenCalledTimes(1);

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    expect(dispatchShortcut(document, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(goClients).toHaveBeenCalledTimes(1);
  });

  it('suppresses navigation sequences while typing', () => {
    const goTickets = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <input aria-label="Search" />
        <Action action={navigationAction('navigation.goTickets', goTickets)} />
      </KeyboardShortcutsProvider>,
    );

    const input = screen.getByLabelText('Search');
    dispatchShortcut(input, { key: 'g', code: 'KeyG' });
    expect(dispatchShortcut(input, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);
    expect(goTickets).not.toHaveBeenCalled();
  });
});
