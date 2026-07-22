/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardShortcutsProvider,
  ShortcutActiveRegion,
  useCatalogShortcut,
  useKeyboardShortcutPreferences,
  useShortcutScope,
} from './provider';

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

function RegisteredCatalogShortcut({
  actionId,
  handler,
  enabled,
}: {
  actionId: string;
  handler: () => void | boolean;
  enabled?: boolean;
}) {
  useCatalogShortcut(actionId, handler, { enabled });
  return null;
}

function PageScope({ children }: { children?: React.ReactNode }) {
  useShortcutScope('page');
  return <>{children}</>;
}

function PanelScope({ children }: { children?: React.ReactNode }) {
  useShortcutScope('panel');
  return <>{children}</>;
}

function EditorScope({ children }: { children?: React.ReactNode }) {
  useShortcutScope('editor');
  return <>{children}</>;
}

function SettingsProbe() {
  const shortcuts = useKeyboardShortcutPreferences();
  return (
    <div>
      <span data-testid="effective">{shortcuts.getResolvedBindings('global.search').join(',')}</span>
      <button type="button" onClick={() => shortcuts.setActionBindings('global.search', ['mod+j'])}>
        rebind
      </button>
    </div>
  );
}

describe('gap hardening behavioral coverage', () => {
  it('gates selection.* on a real active region but lets page.create fire page-wide', async () => {
    const createHandler = vi.fn();
    const selectionHandler = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <PageScope>
          <RegisteredCatalogShortcut actionId="page.create" handler={createHandler} />
          <RegisteredCatalogShortcut actionId="selection.next" handler={selectionHandler} />
          <button type="button">outside region</button>
          <ShortcutActiveRegion>
            <button type="button">inside region</button>
          </ShortcutActiveRegion>
        </PageScope>
      </KeyboardShortcutsProvider>,
    );

    // Focus outside any active region: page.create still fires (page-wide),
    // selection.next stays inert until a roving-focus region is active.
    screen.getByRole('button', { name: 'outside region' }).focus();
    expect(dispatchShortcut({ key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(createHandler).toHaveBeenCalledTimes(1);
    expect(dispatchShortcut({ key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(false);
    expect(selectionHandler).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'inside region' }).focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inside region' }));
    });
    await waitFor(() => {
      expect(dispatchShortcut({ key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(true);
    });
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(dispatchShortcut({ key: 'c', code: 'KeyC' }).defaultPrevented).toBe(true);
    expect(createHandler).toHaveBeenCalledTimes(2);
  });

  it('dispatches catalog-derived global actions with runtime enabled gates', () => {
    const enabledHandler = vi.fn();
    const disabledHandler = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <RegisteredCatalogShortcut actionId="global.toggleChat" handler={enabledHandler} enabled />
        <RegisteredCatalogShortcut actionId="ai.quickAsk" handler={disabledHandler} enabled={false} />
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut({ key: 'l', code: 'KeyL', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatchShortcut({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(enabledHandler).toHaveBeenCalledTimes(1);
    expect(disabledHandler).not.toHaveBeenCalled();
  });

  it('honors panel scope priority and editor allowInEditable from catalog metadata', () => {
    const pageCreate = vi.fn();
    const panelBack = vi.fn();
    const redo = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <PageScope>
          <ShortcutActiveRegion>
            <button type="button">region</button>
          </ShortcutActiveRegion>
          <RegisteredCatalogShortcut actionId="page.create" handler={pageCreate} />
        </PageScope>
        <PanelScope>
          <RegisteredCatalogShortcut actionId="drawer.historyBack" handler={panelBack} />
        </PanelScope>
        <EditorScope>
          <RegisteredCatalogShortcut actionId="editor.redo" handler={redo} />
          <input aria-label="editor input" />
        </EditorScope>
      </KeyboardShortcutsProvider>,
    );

    screen.getByRole('button', { name: 'region' }).focus();
    expect(dispatchShortcut({ key: 'c', code: 'KeyC' }).defaultPrevented).toBe(false);
    expect(pageCreate).not.toHaveBeenCalled();

    expect(dispatchShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true);
    expect(panelBack).toHaveBeenCalledTimes(1);

    screen.getByLabelText('editor input').focus();
    expect(dispatchShortcut({ key: 'y', code: 'KeyY', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('suppresses editor.deleteSelection and editor.cancel in editable targets', () => {
    const deleteSelection = vi.fn();
    const cancel = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <EditorScope>
          <RegisteredCatalogShortcut actionId="editor.deleteSelection" handler={deleteSelection} />
          <RegisteredCatalogShortcut actionId="editor.cancel" handler={cancel} />
          <input aria-label="palette text field" />
          <button type="button">canvas surface</button>
        </EditorScope>
      </KeyboardShortcutsProvider>,
    );

    // Typing in a text field must not delete the selected block or clear its selection.
    const input = screen.getByLabelText('palette text field');
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Delete', code: 'Delete' });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(deleteSelection).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();

    // On a non-editable canvas surface the same keys keep their editor behavior.
    const button = screen.getByRole('button', { name: 'canvas surface' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Backspace', code: 'Backspace' });
    fireEvent.keyDown(button, { key: 'Escape', code: 'Escape' });
    expect(deleteSelection).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('fires record.previous from page scope when registered on a record-detail page', () => {
    const recordPrevious = vi.fn();

    render(
      <KeyboardShortcutsProvider platform="other">
        <PageScope>
          <RegisteredCatalogShortcut actionId="record.previous" handler={recordPrevious} />
        </PageScope>
      </KeyboardShortcutsProvider>,
    );

    expect(dispatchShortcut({ key: '[', code: 'BracketLeft' }).defaultPrevented).toBe(true);
    expect(recordPrevious).toHaveBeenCalledTimes(1);
  });

  it('settings mutators update resolved bindings through provider state', async () => {
    render(
      <KeyboardShortcutsProvider platform="other">
        <SettingsProbe />
      </KeyboardShortcutsProvider>,
    );

    await screen.findByTestId('effective');
    expect(screen.getByTestId('effective').textContent).toBe('mod+k');

    fireEvent.click(screen.getByRole('button', { name: 'rebind' }));

    await waitFor(() => {
      expect(screen.getByTestId('effective').textContent).toBe('mod+j');
    });
  });
});
