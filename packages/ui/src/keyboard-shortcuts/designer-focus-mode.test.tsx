/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { DesignerFocusSurface } from '../components/designer/DesignerFocusSurface';
import { DesignerFocusToggle } from '../components/designer/DesignerFocusToggle';
import { getShortcutCatalogEntry, SHORTCUT_ACTION_CATALOG } from './catalog';
import { KeyboardShortcutsProvider, useShortcutScope } from './provider';
import { normalizeDefaultBindings } from './registry';
import type { ShortcutScope } from './types';

afterEach(() => {
  cleanup();
});

function Scope({ scope }: { scope: ShortcutScope }) {
  useShortcutScope(scope);
  return null;
}

function Host({ scope, focusable }: { scope?: ShortcutScope; focusable?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <KeyboardShortcutsProvider platform="other">
      {/* The MSP shell pushes the page scope around every route. */}
      <Scope scope="page" />
      {scope ? <Scope scope={scope} /> : null}
      <DesignerFocusSurface
        id="designer-focus-surface"
        focused={focused}
        onFocusedChange={setFocused}
        focusable={focusable}
      >
        <DesignerFocusToggle id="designer-focus-toggle" />
        <input aria-label="designer input" />
      </DesignerFocusSurface>
    </KeyboardShortcutsProvider>
  );
}

function pressToggleShortcut(target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: '.',
        code: 'Period',
        ctrlKey: true,
      })
    );
  });
}

function surface(): HTMLElement | null {
  return document.getElementById('designer-focus-surface');
}

describe('designer.toggleFocusMode catalog entry', () => {
  it('is bound to mod+. at page scope and allowed while typing', () => {
    const entry = getShortcutCatalogEntry('designer.toggleFocusMode');

    expect(entry).toBeDefined();
    expect(entry?.defaultBindings).toEqual(['mod+.']);
    expect(entry?.scope).toBe('page');
    expect(entry?.allowInEditable).toBe(true);
    expect(entry?.groupKey).toBe('groups.editor');
  });

  it('is the only page- or global-scope action bound to mod+.', () => {
    const owners = SHORTCUT_ACTION_CATALOG.filter((candidate) => {
      if (candidate.scope !== 'page' && candidate.scope !== 'global') return false;
      const bindings = normalizeDefaultBindings(candidate.defaultBindings);
      return bindings.mac.includes('mod+.') || bindings.other.includes('mod+.');
    });

    expect(owners.map((owner) => owner.id)).toEqual(['designer.toggleFocusMode']);
  });
});

describe('DesignerFocusSurface shortcut registration', () => {
  it('toggles the surface on and off again', () => {
    render(<Host />);

    pressToggleShortcut();
    expect(surface()).toHaveAttribute('data-focus-mode', 'on');

    pressToggleShortcut();
    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
  });

  it('does nothing once the surface unmounts', () => {
    const { unmount } = render(<Host />);
    unmount();

    expect(() => pressToggleShortcut()).not.toThrow();
    expect(surface()).toBeNull();
  });

  it('fires while a text input inside the designer has focus', () => {
    render(<Host />);
    const input = screen.getByLabelText('designer input');
    input.focus();

    pressToggleShortcut(input);

    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
  });

  it('fires while the editor shortcut scope is active (the invoice designer case)', () => {
    render(<Host scope="editor" />);

    pressToggleShortcut();

    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
  });

  it('is not registered while the surface is not focusable (the workflow list case)', () => {
    render(<Host focusable={false} />);

    pressToggleShortcut();

    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
  });
});

describe('DesignerFocusToggle tooltip', () => {
  it('includes the displayed binding for designer.toggleFocusMode', () => {
    render(<Host />);

    expect(document.getElementById('designer-focus-toggle')?.textContent).toContain('Focus mode (Ctrl+.)');
  });
});
