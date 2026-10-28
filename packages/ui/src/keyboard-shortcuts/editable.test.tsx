/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorPopupOwnsEscape, isKeyboardEventInEditable } from './editable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
