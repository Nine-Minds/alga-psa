/** @vitest-environment jsdom */

import React, { useMemo } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardShortcutsProvider,
  useShortcutAction,
  useShortcutActiveRegion,
  useShortcutScope,
} from './provider';
import type { ShortcutAction, ShortcutScope } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function shortcutAction(overrides: Partial<ShortcutAction> & Pick<ShortcutAction, 'id' | 'handler'>): ShortcutAction {
  return {
    labelKey: `actions.${overrides.id}.label`,
    groupKey: 'groups.test',
    defaultBindings: ['x'],
    scope: 'global',
    ...overrides,
  };
}

function Action({ action }: { action: ShortcutAction }) {
  useShortcutAction(action);
  return null;
}

function Scope({ scope }: { scope: ShortcutScope }) {
  useShortcutScope(scope);
  return null;
}

function ActiveRegion({ active = true }: { active?: boolean }) {
  useShortcutActiveRegion(active);
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

describe('KeyboardShortcutsProvider', () => {
  it('installs exactly one capture-phase document keydown listener for the provider', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const handler = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'global.search', handler })} />
        <Action action={shortcutAction({ id: 'global.help', defaultBindings: ['?'], handler })} />
      </KeyboardShortcutsProvider>,
    );

    const keydownListeners = addSpy.mock.calls.filter((call) => call[0] === 'keydown');
    expect(keydownListeners).toHaveLength(1);
    expect(keydownListeners[0][2]).toBe(true);
  });

  it('registers on mount and unregisters on unmount', () => {
    const handler = vi.fn();
    const action = shortcutAction({ id: 'global.search', defaultBindings: ['mod+k'], handler });
    const { unmount } = render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={action} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    const afterUnmount = dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire or prevent default for disabled actions', () => {
    const handler = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'global.search', defaultBindings: ['mod+k'], enabled: false, handler })} />
      </KeyboardShortcutsProvider>,
    );

    const event = dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    rerender(
      <KeyboardShortcutsProvider platform="other" disabledActionIds={['global.search']}>
        <Action action={shortcutAction({ id: 'global.search', defaultBindings: ['mod+k'], handler })} />
      </KeyboardShortcutsProvider>,
    );

    const disabledByProvider = dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(disabledByProvider.defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('prevents default only when the winning action handles the event', () => {
    const skipped = vi.fn(() => false);
    const handled = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'global.skipped', defaultBindings: ['mod+k'], handler: skipped })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);

    rerender(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'global.handled', defaultBindings: ['mod+k'], handler: handled })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('ref-counts active scopes until the last consumer unmounts', () => {
    const handler = vi.fn();

    function ScopedPair({ showFirst, showSecond }: { showFirst: boolean; showSecond: boolean }) {
      return (
        <KeyboardShortcutsProvider platform="other">
          {showFirst ? <Scope scope="panel" /> : null}
          {showSecond ? <Scope scope="panel" /> : null}
          <Action action={shortcutAction({ id: 'panel.close', defaultBindings: ['x'], scope: 'panel', handler })} />
        </KeyboardShortcutsProvider>
      );
    }

    const { rerender } = render(<ScopedPair showFirst showSecond />);
    dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(handler).toHaveBeenCalledTimes(1);

    rerender(<ScopedPair showFirst showSecond={false} />);
    dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(handler).toHaveBeenCalledTimes(2);

    rerender(<ScopedPair showFirst={false} showSecond={false} />);
    expect(dispatchShortcut(document, { key: 'x', code: 'KeyX' }).defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('clears active scopes on route key change', () => {
    const handler = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other" routeKey="/one">
        <Scope scope="page" />
        <Action action={shortcutAction({ id: 'page.save', defaultBindings: ['mod+s'], scope: 'page', handler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    rerender(
      <KeyboardShortcutsProvider platform="other" routeKey="/two">
        <Scope scope="page" />
        <Action action={shortcutAction({ id: 'page.save', defaultBindings: ['mod+s'], scope: 'page', handler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips dispatch when the event was already defaultPrevented', () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'global.search', defaultBindings: ['mod+k'], handler })} />
      </KeyboardShortcutsProvider>,
    );

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('filters matched actions to active scopes only', () => {
    const handler = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other">
        <Action action={shortcutAction({ id: 'page.save', defaultBindings: ['mod+s'], scope: 'page', handler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    rerender(
      <KeyboardShortcutsProvider platform="other">
        <Scope scope="page" />
        <Action action={shortcutAction({ id: 'page.save', defaultBindings: ['mod+s'], scope: 'page', handler })} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uses priority first, then the most-local active scope', () => {
    const globalHandler = vi.fn();
    const pageHandler = vi.fn();
    const panelHandler = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <Scope scope="page" />
        <Scope scope="panel" />
        <Action action={shortcutAction({ id: 'global.x', defaultBindings: ['x'], priority: 10, handler: globalHandler })} />
        <Action action={shortcutAction({ id: 'page.x', defaultBindings: ['x'], scope: 'page', priority: 1, handler: pageHandler })} />
        <Action action={shortcutAction({ id: 'panel.x', defaultBindings: ['x'], scope: 'panel', priority: 1, handler: panelHandler })} />
      </KeyboardShortcutsProvider>,
    );

    dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(globalHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).not.toHaveBeenCalled();
    expect(panelHandler).not.toHaveBeenCalled();

    cleanup();

    render(
      <KeyboardShortcutsProvider platform="other">
        <Scope scope="page" />
        <Scope scope="panel" />
        <Action action={shortcutAction({ id: 'page.x', defaultBindings: ['x'], scope: 'page', priority: 1, handler: pageHandler })} />
        <Action action={shortcutAction({ id: 'panel.x', defaultBindings: ['x'], scope: 'panel', priority: 1, handler: panelHandler })} />
      </KeyboardShortcutsProvider>,
    );

    dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(panelHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('reports residual ties as conflicts instead of using registration order', () => {
    const first = vi.fn();
    const second = vi.fn();
    const onConflict = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other" onConflict={onConflict}>
        <Action action={shortcutAction({ id: 'global.first', defaultBindings: ['x'], handler: first })} />
        <Action action={shortcutAction({ id: 'global.second', defaultBindings: ['x'], handler: second })} />
      </KeyboardShortcutsProvider>,
    );

    const event = dispatchShortcut(document, { key: 'x', code: 'KeyX' });
    expect(event.defaultPrevented).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(onConflict).toHaveBeenCalledWith({
      binding: 'x',
      actionIds: ['global.first', 'global.second'],
    });
  });

  it('suppresses shortcuts in editable targets unless allowInEditable is true', () => {
    const blocked = vi.fn();
    const allowed = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other">
        <input aria-label="field" />
        <Action action={shortcutAction({ id: 'global.blocked', defaultBindings: ['mod+k'], handler: blocked })} />
      </KeyboardShortcutsProvider>,
    );

    const input = screen.getByLabelText('field');
    expect(dispatchShortcut(input, { key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(blocked).not.toHaveBeenCalled();

    rerender(
      <KeyboardShortcutsProvider platform="other">
        <input aria-label="field" />
        <Action
          action={shortcutAction({
            id: 'global.allowed',
            defaultBindings: ['mod+k'],
            allowInEditable: true,
            handler: allowed,
          })}
        />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(screen.getByLabelText('field'), { key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(allowed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['textarea', <textarea aria-label="editable" key="textarea" />],
    ['select', <select aria-label="editable" key="select" />],
    ['contenteditable', <div aria-label="editable" contentEditable key="contenteditable" />],
    ['role textbox', <div aria-label="editable" role="textbox" key="textbox" />],
    ['role combobox', <div aria-label="editable" role="combobox" key="combobox" />],
    ['editor root', <div aria-label="editable" data-keyboard-shortcuts-editor-root="true" key="editor" />],
  ])('suppresses shortcuts in %s targets', (_name, element) => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="other">
        {element}
        <Action action={shortcutAction({ id: 'global.blocked', defaultBindings: ['x'], handler })} />
      </KeyboardShortcutsProvider>,
    );

    const target = screen.getByLabelText('editable');
    expect(dispatchShortcut(target, { key: 'x', code: 'KeyX' }).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires an active region for selection actions but not single-letter page actions', () => {
    const selectionHandler = vi.fn();
    const pageHandler = vi.fn();

    function Harness({ activeRegion }: { activeRegion: boolean }) {
      const selection = useMemo(
        () => shortcutAction({ id: 'selection.next', defaultBindings: ['j'], scope: 'page', handler: selectionHandler }),
        [],
      );
      const page = useMemo(
        () => shortcutAction({ id: 'page.create', defaultBindings: ['c'], scope: 'page', handler: pageHandler }),
        [],
      );

      return (
        <KeyboardShortcutsProvider platform="other">
          <Scope scope="page" />
          {activeRegion ? <ActiveRegion /> : null}
          <Action action={selection} />
          <Action action={page} />
          <button type="button">Focusable</button>
        </KeyboardShortcutsProvider>
      );
    }

    const { rerender } = render(<Harness activeRegion={false} />);
    expect(dispatchShortcut(document, { key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(false);
    expect(selectionHandler).not.toHaveBeenCalled();
    expect(dispatchShortcut(document, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(pageHandler).toHaveBeenCalledTimes(1);

    rerender(<Harness activeRegion />);
    expect(dispatchShortcut(document, { key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(true);
    expect(dispatchShortcut(document, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).toHaveBeenCalledTimes(2);
  });

  it('dispatches across a full action catalog without measurable input latency', () => {
    const handler = vi.fn();
    const fillerActions = Array.from({ length: 250 }, (_, index) =>
      shortcutAction({
        id: `global.filler.${index}`,
        defaultBindings: ['f1'],
        handler: vi.fn(),
      }),
    );

    render(
      <KeyboardShortcutsProvider platform="other">
        {fillerActions.map((action) => (
          <Action key={action.id} action={action} />
        ))}
        <Action action={shortcutAction({ id: 'global.search', defaultBindings: ['mod+k'], handler })} />
      </KeyboardShortcutsProvider>,
    );

    const startedAt = performance.now();
    const event = dispatchShortcut(document, { key: 'k', code: 'KeyK', ctrlKey: true });
    const elapsedMs = performance.now() - startedAt;

    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(25);
  });
});
