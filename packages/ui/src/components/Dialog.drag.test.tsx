/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Dialog } from './Dialog';

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

function renderDialog(isOpen = true) {
  const onClose = vi.fn();
  const view = render(
    <Dialog isOpen={isOpen} onClose={onClose} id="availability-settings" title="Availability Settings">
      <button type="button">Save User Hours</button>
    </Dialog>,
  );
  return { onClose, view };
}

function dragHandle(): HTMLElement {
  const handle = document.querySelector('[data-drag-handle]');
  if (!handle) throw new Error('drag handle not rendered');
  return handle as HTMLElement;
}

function panel(): HTMLElement {
  const content = document.querySelector('[role="dialog"]');
  if (!content) throw new Error('dialog content not rendered');
  return content as HTMLElement;
}

describe('Dialog dragging', () => {
  afterEach(() => cleanup());

  it('follows the pointer while the button is held', () => {
    renderDialog();

    fireEvent.mouseDown(dragHandle(), { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130, buttons: 1 });

    expect(panel().style.transform).toContain('40px');
    expect(panel().style.cursor).toBe('move');
  });

  it('stops dragging when the button was released outside the window', () => {
    renderDialog();

    fireEvent.mouseDown(dragHandle(), { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130, buttons: 1 });
    const draggedTo = panel().style.transform;

    // The release happened over another window, so no mouseup ever arrives -
    // only later moves with no button held.
    fireEvent.mouseMove(document, { clientX: 400, clientY: 500, buttons: 0 });
    expect(panel().style.cursor).toBe('auto');

    fireEvent.mouseMove(document, { clientX: 900, clientY: 200, buttons: 0 });
    expect(panel().style.transform).toBe(draggedTo);
  });

  it('stops dragging when the window loses focus', () => {
    renderDialog();

    fireEvent.mouseDown(dragHandle(), { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130, buttons: 1 });
    expect(panel().style.cursor).toBe('move');

    fireEvent.blur(window);

    expect(panel().style.cursor).toBe('auto');
  });

  it('drops the drag listeners when the dialog closes', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog isOpen onClose={onClose} id="availability-settings" title="Availability Settings">
        <button type="button">Save User Hours</button>
      </Dialog>,
    );

    fireEvent.mouseDown(dragHandle(), { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130, buttons: 1 });

    rerender(
      <Dialog isOpen={false} onClose={onClose} id="availability-settings" title="Availability Settings">
        <button type="button">Save User Hours</button>
      </Dialog>,
    );

    // A closed dialog must not keep re-rendering on every mouse move: the page
    // behind it stays clickable only while nothing is tracking the pointer.
    const moved = fireEvent.mouseMove(document, { clientX: 900, clientY: 200, buttons: 1 });
    expect(moved).toBe(true);

    rerender(
      <Dialog isOpen onClose={onClose} id="availability-settings" title="Availability Settings">
        <button type="button">Save User Hours</button>
      </Dialog>,
    );

    expect(panel().style.cursor).toBe('auto');
  });
});
