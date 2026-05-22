/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardShortcutsProvider,
  useShortcutAction,
  useShortcutScope,
} from './provider';
import type { ShortcutAction } from './types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function action(overrides: Partial<ShortcutAction> & Pick<ShortcutAction, 'id' | 'handler'>): ShortcutAction {
  return {
    labelKey: `actions.${overrides.id}.label`,
    groupKey: 'groups.test',
    defaultBindings: ['g t'],
    scope: 'global',
    sequence: true,
    ...overrides,
  };
}

function Action({ value }: { value: ShortcutAction }) {
  useShortcutAction(value);
  return null;
}

function Scope() {
  useShortcutScope('page');
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

describe('keyboard shortcut sequences', () => {
  it("resolves and invokes a 'g t' sequence action", () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        <Action value={action({ id: 'global.goTickets', handler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'g', code: 'KeyG' }).defaultPrevented).toBe(false);
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('times out the buffer after the configured interval', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other" sequenceTimeoutMs={50}>
        <Action value={action({ id: 'global.goTickets', handler })} />
      </KeyboardShortcutsProvider>,
    );

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    vi.advanceTimersByTime(51);
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('resets on a non-matching key, scope change, and route change', () => {
    const handler = vi.fn();
    const sequenceAction = action({ id: 'global.goTickets', handler });
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other" routeKey="/one">
        <Action value={sequenceAction} />
      </KeyboardShortcutsProvider>,
    );

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    rerender(
      <KeyboardShortcutsProvider platform="other" routeKey="/one">
        <Scope />
        <Action value={sequenceAction} />
      </KeyboardShortcutsProvider>,
    );
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);

    dispatchShortcut(document, { key: 'g', code: 'KeyG' });
    rerender(
      <KeyboardShortcutsProvider platform="other" routeKey="/two">
        <Scope />
        <Action value={sequenceAction} />
      </KeyboardShortcutsProvider>,
    );
    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('suppresses sequence navigation while typing in editable targets', () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        <input aria-label="field" />
        <Action value={action({ id: 'global.goTickets', handler })} />
      </KeyboardShortcutsProvider>,
    );

    const input = screen.getByLabelText('field');
    dispatchShortcut(input, { key: 'g', code: 'KeyG' });
    expect(dispatchShortcut(input, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets a single-chord action and a sequence with the same first chord coexist', () => {
    const singleHandler = vi.fn();
    const sequenceHandler = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <Action
          value={{
            ...action({ id: 'global.singleG', defaultBindings: ['g'], handler: singleHandler }),
            sequence: false,
          }}
        />
        <Action value={action({ id: 'global.goTickets', handler: sequenceHandler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'g', code: 'KeyG' }).defaultPrevented).toBe(true);
    expect(singleHandler).toHaveBeenCalledTimes(1);
    expect(sequenceHandler).not.toHaveBeenCalled();

    expect(dispatchShortcut(document, { key: 't', code: 'KeyT' }).defaultPrevented).toBe(true);
    expect(sequenceHandler).toHaveBeenCalledTimes(1);
  });
});
