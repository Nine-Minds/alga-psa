/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPTIONAL_ALTERNATE_BINDINGS, getShortcutCatalogEntry } from './catalog';
import {
  KeyboardShortcutsProvider,
  usePageCreateShortcut,
  usePageSaveShortcut,
  useShortcutActiveRegion,
  useShortcutScope,
} from './index';

afterEach(() => {
  cleanup();
});

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

function PageScope() {
  useShortcutScope('page');
  return null;
}

function PanelScope() {
  useShortcutScope('panel');
  return null;
}

function ActiveRegion() {
  useShortcutActiveRegion(true);
  return null;
}

function PageActions({
  onCreate,
  onSave,
  saveEnabled = true,
}: {
  onCreate: () => void;
  onSave: () => void;
  saveEnabled?: boolean;
}) {
  usePageCreateShortcut(onCreate);
  usePageSaveShortcut(onSave, { enabled: saveEnabled });
  return <input aria-label="Editable field" />;
}

describe('page action shortcuts', () => {
  it('catalogues page.create as c and keeps mod+n only as an optional alternate', () => {
    expect(getShortcutCatalogEntry('page.create')?.defaultBindings).toEqual(['c']);
    expect(OPTIONAL_ALTERNATE_BINDINGS['page.create']).toEqual(['mod+n']);
  });

  it('dispatches page.create and page.save through shared page helpers', () => {
    const onCreate = vi.fn();
    const onSave = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <PageScope />
        <ActiveRegion />
        <PageActions onCreate={onCreate} onSave={onSave} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('suppresses page actions in editable targets and while a panel scope owns the route', () => {
    const onCreate = vi.fn();
    const onSave = vi.fn();

    const { rerender } = render(
      <KeyboardShortcutsProvider platform="other">
        <PageScope />
        <ActiveRegion />
        <PageActions onCreate={onCreate} onSave={onSave} />
      </KeyboardShortcutsProvider>,
    );

    const input = screen.getByLabelText('Editable field');
    expect(dispatchShortcut(input, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(false);
    expect(dispatchShortcut(input, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <KeyboardShortcutsProvider platform="other">
        <PageScope />
        <PanelScope />
        <ActiveRegion />
        <PageActions onCreate={onCreate} onSave={onSave} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut(document, { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(false);
    expect(dispatchShortcut(document, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
