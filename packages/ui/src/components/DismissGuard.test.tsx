/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Dialog } from './Dialog';
import Drawer from './Drawer';
import { guardActiveDismiss, useRegisterDismissGuard } from './DismissGuard';
import InlineReplyComposer from './InlineReplyComposer';

// The real editor is far too heavy for jsdom; a contenteditable that reports its
// text like TextEditor's onContentChange does is enough to drive the composer.
vi.mock('../editor', () => ({
  TextEditor: ({ onContentChange }: { onContentChange?: (content: unknown[]) => void }) => (
    <div
      className="ProseMirror"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-label="Reply editor"
      onInput={(event) =>
        onContentChange?.([
          { type: 'paragraph', content: [{ type: 'text', text: event.currentTarget.textContent ?? '', styles: {} }] },
        ])
      }
    />
  ),
}));

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: {} } },
      interpolation: { escapeValue: false },
    });
  }
});

afterEach(() => cleanup());

const pressEscape = (target: Element | Document = document) =>
  fireEvent.keyDown(target, { key: 'Escape', bubbles: true });

const question = () => screen.queryByText('Discard unsaved changes?');

function typeInto(editor: HTMLElement, text: string) {
  editor.focus();
  editor.textContent = text;
  fireEvent.input(editor);
}

function DirtyChild({ dirty }: { dirty: boolean }) {
  useRegisterDismissGuard(dirty);
  return <textarea aria-label="draft" />;
}

describe('Dialog with unsaved changes', () => {
  it('Escape asks instead of closing, and Discard then closes', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="guarded" title="New ticket" hasUnsavedChanges>
        <textarea aria-label="draft" />
      </Dialog>,
    );

    pressEscape();

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Keep editing dismisses the question, keeps the dialog open and the text intact', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="guarded" title="New ticket" hasUnsavedChanges>
        <textarea aria-label="draft" defaultValue="half-written description" />
      </Dialog>,
    );

    pressEscape();
    await waitFor(() => expect(question()).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(question()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('draft') as HTMLTextAreaElement).value).toBe('half-written description');
  });

  it('a second Escape while the question is open does not discard', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="guarded" title="New ticket" hasUnsavedChanges>
        <textarea aria-label="draft" />
      </Dialog>,
    );

    pressEscape();
    await waitFor(() => expect(question()).toBeTruthy());
    pressEscape(screen.getByRole('button', { name: 'Keep editing' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('the X button asks as well', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="guarded" title="New ticket" hasUnsavedChanges>
        <textarea aria-label="draft" />
      </Dialog>,
    );

    fireEvent.click(document.querySelector('[data-automation-id="guarded-dialog"] button[aria-label="Close"]')!);

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape on a clean dialog still closes it without asking', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="clean" title="New ticket">
        <textarea aria-label="draft" />
      </Dialog>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(question()).toBeNull();
  });

  it('asks when content inside the dialog registers unsaved changes, and stops asking once it is clean', async () => {
    const onClose = vi.fn();
    function Harness() {
      const [dirty, setDirty] = useState(true);
      return (
        <Dialog isOpen onClose={onClose} id="registered" title="Ticket">
          <DirtyChild dirty={dirty} />
          <button type="button" onClick={() => setDirty(false)}>
            saved
          </button>
        </Dialog>
      );
    }
    render(<Harness />);

    pressEscape();
    await waitFor(() => expect(question()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());

    fireEvent.click(screen.getByText('saved'));
    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets an open editor popup take the Escape instead of the dialog', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="popup" title="Ticket" hasUnsavedChanges>
        <div className="ProseMirror" contentEditable suppressContentEditableWarning tabIndex={0} aria-label="editor" />
        <div className="bn-suggestion-menu" />
      </Dialog>,
    );

    const editor = screen.getByLabelText('editor');
    editor.focus();
    pressEscape(editor);

    expect(onClose).not.toHaveBeenCalled();
    expect(question()).toBeNull();
  });

  it('a nested dialog keeps its own Escape and the parent is not asked', () => {
    const onCloseParent = vi.fn();
    const onCloseNested = vi.fn();
    render(
      <Dialog isOpen onClose={onCloseParent} id="parent" title="Parent" hasUnsavedChanges>
        <Dialog isOpen onClose={onCloseNested} id="nested" title="Nested">
          <button type="button">inside</button>
        </Dialog>
      </Dialog>,
    );

    pressEscape(document.querySelector('[data-automation-id="nested-dialog"] button')!);

    expect(onCloseNested).toHaveBeenCalledTimes(1);
    expect(onCloseParent).not.toHaveBeenCalled();
    expect(question()).toBeNull();
  });
});

describe('Drawer with unsaved changes', () => {
  it('Escape asks; Keep editing keeps it open; Discard closes', async () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen onClose={onClose} id="ticket-drawer" hasUnsavedChanges>
        <textarea aria-label="draft" />
      </Drawer>,
    );

    pressEscape();
    await waitFor(() => expect(question()).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    await waitFor(() => expect(question()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the X button and the guarded header actions ask too', async () => {
    const onClose = vi.fn();
    const headerAction = vi.fn();
    render(
      <Drawer isOpen onClose={onClose} id="ticket-drawer" hasUnsavedChanges>
        <textarea aria-label="draft" />
      </Drawer>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(question()).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());

    act(() => guardActiveDismiss(headerAction));
    await waitFor(() => expect(question()).toBeTruthy());
    expect(headerAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(headerAction).toHaveBeenCalledTimes(1);
  });

  it('Escape on a clean drawer still closes it', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen onClose={onClose} id="ticket-drawer">
        <textarea aria-label="draft" />
      </Drawer>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks browser history chords while dirty, but never inside the editor', () => {
    render(
      <Drawer isOpen onClose={vi.fn()} id="ticket-drawer" hasUnsavedChanges>
        <div className="ProseMirror" contentEditable suppressContentEditableWarning tabIndex={0} aria-label="editor" />
        <button type="button">elsewhere</button>
      </Drawer>,
    );

    const editor = screen.getByLabelText('editor');
    editor.focus();
    const inEditor = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(inEditor);
    expect(inEditor.defaultPrevented).toBe(false);

    const button = screen.getByText('elsewhere');
    button.focus();
    const outside = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true, cancelable: true });
    button.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
  });

  it('does not block history chords when nothing is dirty', () => {
    render(
      <Drawer isOpen onClose={vi.fn()} id="ticket-drawer">
        <button type="button">elsewhere</button>
      </Drawer>,
    );

    const button = screen.getByText('elsewhere');
    button.focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('comment reply composer inside a drawer', () => {
  function renderComposer(onClose = vi.fn()) {
    render(
      <Drawer isOpen onClose={onClose} id="thread-drawer">
        <InlineReplyComposer parentCommentId="c1" roomName="reply-room" onSubmit={vi.fn()} onCancel={onClose} />
      </Drawer>,
    );
    return { onClose, editor: screen.getByLabelText('Reply editor') };
  }

  it('Escape with a typed reply asks; Keep editing leaves the text in place', async () => {
    const { onClose, editor } = renderComposer();
    typeInto(editor, 'Hi Anthony, following up on the printer');

    pressEscape(editor);

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reply editor').textContent).toBe('Hi Anthony, following up on the printer');
  });

  it('Discard closes the drawer', async () => {
    const { onClose, editor } = renderComposer();
    typeInto(editor, 'draft');

    pressEscape(editor);
    await waitFor(() => expect(question()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape with an untouched or blanked-out reply closes immediately', () => {
    const { onClose, editor } = renderComposer();
    typeInto(editor, 'x');
    typeInto(editor, '   ');

    pressEscape(editor);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(question()).toBeNull();
  });

  it('Cmd+Arrow inside the reply editor does not close anything or ask', () => {
    const { onClose, editor } = renderComposer();
    typeInto(editor, 'draft');

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(onClose).not.toHaveBeenCalled();
    expect(question()).toBeNull();
    expect(editor.textContent).toBe('draft');
  });
});
