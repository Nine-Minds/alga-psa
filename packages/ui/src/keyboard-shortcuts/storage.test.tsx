/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsProvider, useShortcutStorage } from './provider';
import { createMemoryShortcutStorage, DEFAULT_PERSISTED_SHORTCUTS } from './storage';
import type { PersistedShortcuts, ShortcutStorage } from './types';

function StorageProbe() {
  const storage = useShortcutStorage();

  React.useEffect(() => {
    Promise.resolve(storage.load()).then((value: PersistedShortcuts) => {
      document.body.setAttribute('data-shortcut-version', String(value.version));
    });
  }, [storage]);

  return <span>storage probe</span>;
}

describe('shortcut storage boundary', () => {
  it('provides an in-memory storage adapter by default', async () => {
    const storage = createMemoryShortcutStorage();
    await expect(storage.load()).resolves.toEqual(DEFAULT_PERSISTED_SHORTCUTS);

    await storage.save({
      version: 1,
      profile: 'default',
      bindings: { 'global.search': ['mod+j'] },
      disabled: ['global.help'],
    });

    await expect(storage.load()).resolves.toEqual({
      version: 1,
      profile: 'default',
      bindings: { 'global.search': ['mod+j'] },
      disabled: ['global.help'],
    });
  });

  it('accepts an injected storage adapter through the provider', async () => {
    const storage: ShortcutStorage = {
      load: vi.fn(async () => ({
        version: 7,
        profile: 'default',
        bindings: {},
        disabled: [],
      })),
      save: vi.fn(async () => undefined),
    };

    render(
      <KeyboardShortcutsProvider platform="other" storage={storage}>
        <StorageProbe />
      </KeyboardShortcutsProvider>,
    );

    expect(screen.getByText('storage probe')).toBeTruthy();
    await waitFor(() => {
      expect(document.body.getAttribute('data-shortcut-version')).toBe('7');
    });
    expect(storage.load).toHaveBeenCalled();
  });
});
