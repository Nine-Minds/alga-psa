/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';
import { ShortcutHint, useAriaKeyShortcuts } from './display';
import { KeyboardShortcutsProvider, useKeyboardShortcutPreferences, useShortcutAction } from './provider';
import { EMPTY_SHORTCUT_PREFERENCES } from './preferences';
import type { PersistedShortcuts, ShortcutAction, ShortcutStorage } from './types';

afterEach(() => {
  cleanup();
});

function dispatchShortcut(init: KeyboardEventInit & { key: string; code: string }) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });

  document.dispatchEvent(event);
  return event;
}

function createStorage(initial: PersistedShortcuts = EMPTY_SHORTCUT_PREFERENCES): ShortcutStorage & { saved: PersistedShortcuts[] } {
  let current = initial;
  const saved: PersistedShortcuts[] = [];

  return {
    saved,
    load: vi.fn(() => current),
    save: vi.fn((next) => {
      current = next;
      saved.push(next);
    }),
  };
}

function searchAction(handler: ShortcutAction['handler']): ShortcutAction {
  return {
    id: 'global.search',
    labelKey: 'actions.global.search.label',
    descriptionKey: 'actions.global.search.description',
    groupKey: 'groups.global',
    defaultBindings: ['mod+k'],
    scope: 'global',
    handler,
  };
}

function RegisteredAction({ handler }: { handler: ShortcutAction['handler'] }) {
  useShortcutAction(searchAction(handler));
  return null;
}

function AriaProbe() {
  const aria = useAriaKeyShortcuts('global.search');
  return <button aria-keyshortcuts={aria} type="button">Search control</button>;
}

function SettingsProbe() {
  const shortcuts = useKeyboardShortcutPreferences();
  const effective = shortcuts.getResolvedBindings('global.search').join(', ');

  if (!shortcuts.preferencesLoaded) {
    return <span>loading</span>;
  }

  return (
    <div>
      <span data-testid="effective-binding">{effective}</span>
      <button type="button" onClick={() => shortcuts.setActionBindings('global.search', ['mod+j'])}>
        Rebind search
      </button>
      <button type="button" onClick={() => shortcuts.setActionDisabled('global.search', true)}>
        Disable search
      </button>
      <button type="button" onClick={() => shortcuts.resetAction('global.search')}>
        Reset search
      </button>
      <button type="button" onClick={() => shortcuts.resetAllShortcuts()}>
        Reset all
      </button>
    </div>
  );
}

function Harness({
  handler,
  helpOpen = false,
  storage = createStorage(),
}: {
  handler: ShortcutAction['handler'];
  helpOpen?: boolean;
  storage?: ShortcutStorage;
}) {
  return (
    <KeyboardShortcutsProvider platform="other" storage={storage}>
      <RegisteredAction handler={handler} />
      <SettingsProbe />
      <ShortcutHint actionId="global.search" />
      <AriaProbe />
      <ShortcutHelpDialog isOpen={helpOpen} onClose={() => undefined} />
    </KeyboardShortcutsProvider>
  );
}

describe('keyboard shortcut customization wiring', () => {
  it('rebinds dispatch, settings effective binding, hint, and aria from one provider source', async () => {
    const handler = vi.fn();
    render(<Harness handler={handler} />);

    await screen.findByTestId('effective-binding');
    expect(screen.getByTestId('effective-binding').textContent).toBe('mod+k');
    expect(screen.getByText('Ctrl+k')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search control' }).getAttribute('aria-keyshortcuts')).toBe('Control+K');

    fireEvent.click(screen.getByRole('button', { name: 'Rebind search' }));

    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+j');
    });
    expect(screen.getByText('Ctrl+j')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search control' }).getAttribute('aria-keyshortcuts')).toBe('Control+J');

    expect(dispatchShortcut({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(dispatchShortcut({ key: 'j', code: 'KeyJ', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('disables an action in dispatch and hides it from help', async () => {
    const handler = vi.fn();
    render(<Harness handler={handler} helpOpen />);

    await screen.findByTestId('effective-binding');
    expect(screen.getByText('actions.global.search.label')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Disable search', hidden: true }));

    await waitFor(() => {
      expect(screen.queryByText('actions.global.search.label')).toBeNull();
    });

    expect(dispatchShortcut({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reset-one and reset-all live-update dispatch and hints', async () => {
    const handler = vi.fn();
    render(<Harness handler={handler} />);

    await screen.findByTestId('effective-binding');
    fireEvent.click(screen.getByRole('button', { name: 'Rebind search' }));
    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+j');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+k');
    });
    expect(screen.getByText('Ctrl+k')).toBeTruthy();
    expect(dispatchShortcut({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Rebind search' }));
    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+j');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+k');
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('loads persisted overrides from injected storage before dispatching', async () => {
    const handler = vi.fn();
    const storage = createStorage({
      version: 1,
      profile: 'default',
      bindings: { 'global.search': ['mod+j'] },
      disabled: [],
    });

    render(<Harness handler={handler} storage={storage} />);

    await waitFor(() => {
      expect(screen.getByTestId('effective-binding').textContent).toBe('mod+j');
    });

    expect(dispatchShortcut({ key: 'j', code: 'KeyJ', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatchShortcut({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
