/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsProvider, useShortcutAction } from './provider';
import type { ShortcutAction } from './types';
import { editorPopupOwnsEscape, isKeyboardEventInEditable } from './editable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Action({ action }: { action: ShortcutAction }) {
  useShortcutAction(action);
  return null;
}

function arrowAction(id: string, binding: string, handler: () => void): ShortcutAction {
  return {
    id,
    labelKey: `actions.${id}.label`,
    groupKey: 'groups.test',
    defaultBindings: [binding],
    scope: 'global',
    handler,
  };
}

function press(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// A BlockNote-like editor: a ProseMirror contenteditable inside a wrapper.
function Editor() {
  return (
    <div className="bn-container">
      <div className="bn-editor">
        <div className="ProseMirror" contentEditable tabIndex={0} aria-label="editor" suppressContentEditableWarning>
          typed text
        </div>
      </div>
    </div>
  );
}

const CHORDS = [
  ['Cmd+ArrowUp', 'mod+ArrowUp', { key: 'ArrowUp', code: 'ArrowUp', metaKey: true }, 'mac'],
  ['Ctrl+ArrowUp', 'mod+ArrowUp', { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }, 'other'],
  ['Cmd+ArrowLeft', 'mod+ArrowLeft', { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }, 'mac'],
  ['Ctrl+ArrowRight', 'mod+ArrowRight', { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }, 'other'],
  ['Cmd+ArrowDown', 'mod+ArrowDown', { key: 'ArrowDown', code: 'ArrowDown', metaKey: true }, 'mac'],
] as const;

describe('Cmd/Ctrl+Arrow while typing in the rich-text editor', () => {
  it.each(CHORDS)('%s does not fire a registered shortcut and is left to the editor', (_name, binding, init, platform) => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform={platform}>
        <Editor />
        <Action action={arrowAction('global.chord', binding, handler)} />
      </KeyboardShortcutsProvider>,
    );

    const editor = screen.getByLabelText('editor');
    editor.focus();

    const event = press(editor, init);

    expect(handler).not.toHaveBeenCalled();
    // Not prevented: the browser still moves the caret to the start/end of the line or document.
    expect(event.defaultPrevented).toBe(false);
    expect(editor.textContent).toBe('typed text');
  });

  it('still blocks the shortcut when the event is dispatched at the document while the caret is in the editor', () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="mac">
        <Editor />
        <Action action={arrowAction('global.chord', 'mod+ArrowUp', handler)} />
      </KeyboardShortcutsProvider>,
    );

    screen.getByLabelText('editor').focus();
    const event = press(document, { key: 'ArrowUp', code: 'ArrowUp', metaKey: true });

    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps the shortcut working when focus is not in an editable element', () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcutsProvider platform="mac">
        <Editor />
        <button type="button">elsewhere</button>
        <Action action={arrowAction('global.chord', 'mod+ArrowUp', handler)} />
      </KeyboardShortcutsProvider>,
    );

    const button = screen.getByText('elsewhere');
    button.focus();
    press(button, { key: 'ArrowUp', code: 'ArrowUp', metaKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('editable helpers', () => {
  it('detects focus inside an editor when the event target is not an element', () => {
    render(<Editor />);
    screen.getByLabelText('editor').focus();

    expect(isKeyboardEventInEditable({ target: document })).toBe(true);
  });

  it('reports that an editor popup owns Escape only while an editor has focus', () => {
    render(
      <>
        <Editor />
        <button type="button">elsewhere</button>
        <div data-editor-popup="true" />
      </>,
    );

    screen.getByText('elsewhere').focus();
    expect(editorPopupOwnsEscape()).toBe(false);

    screen.getByLabelText('editor').focus();
    expect(editorPopupOwnsEscape()).toBe(true);
  });

  it('does not treat Escape as popup-owned when no popup is open', () => {
    render(<Editor />);
    screen.getByLabelText('editor').focus();

    expect(editorPopupOwnsEscape()).toBe(false);
  });
});
