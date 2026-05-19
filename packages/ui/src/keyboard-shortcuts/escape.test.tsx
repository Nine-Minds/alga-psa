/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardShortcutsProvider,
  useRadixEscapeOwner,
  useShortcutAction,
} from './index';
import { __resetRadixEscapeOwnersForTests } from './escape';
import type { ShortcutAction } from './types';

afterEach(() => {
  cleanup();
  __resetRadixEscapeOwnersForTests();
});

function Action({ value }: { value: ShortcutAction }) {
  useShortcutAction(value);
  return null;
}

function RadixOwner({ active = true }: { active?: boolean }) {
  useRadixEscapeOwner(active);
  return null;
}

function dispatchEscape(target: EventTarget) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function panelCloseAction(handler: ShortcutAction['handler']): ShortcutAction {
  return {
    id: 'panel.close',
    labelKey: 'actions.panel.close.label',
    groupKey: 'groups.panel',
    defaultBindings: ['Escape'],
    scope: 'global',
    handler,
  };
}

describe('Radix Escape integration', () => {
  it('does not run a competing global Escape action while a Radix modal owns Escape', () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        <RadixOwner />
        <Action value={panelCloseAction(handler)} />
      </KeyboardShortcutsProvider>,
    );

    const event = dispatchEscape(document);
    expect(event.defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not double-fire for nested Radix owners; the local top modal handles Escape once', () => {
    const globalHandler = vi.fn();
    const close = vi.fn();
    const localHandler = vi.fn((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    });

    render(
      <KeyboardShortcutsProvider platform="other">
        <RadixOwner />
        <RadixOwner />
        <Action value={panelCloseAction(globalHandler)} />
        <div tabIndex={-1} onKeyDown={localHandler} data-testid="top-modal" />
      </KeyboardShortcutsProvider>,
    );

    const event = dispatchEscape(screen.getByTestId('top-modal'));
    expect(event.defaultPrevented).toBe(false);
    expect(globalHandler).not.toHaveBeenCalled();
    expect(localHandler).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('lets panel.close handle Escape when no Radix modal owns it', () => {
    const close = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        <Action value={panelCloseAction(close)} />
      </KeyboardShortcutsProvider>,
    );

    const event = dispatchEscape(document);
    expect(event.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
