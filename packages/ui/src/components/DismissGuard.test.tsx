/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Dialog } from './Dialog';
import { guardActiveDismiss, useRegisterDismissGuard } from './DismissGuard';

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
