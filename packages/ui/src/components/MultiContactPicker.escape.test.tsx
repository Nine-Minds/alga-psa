/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Dialog } from './Dialog';
import MultiContactPicker from './MultiContactPicker';

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

const contacts = [
  { contact_name_id: 'c1', full_name: 'Ada Lovelace', email: 'ada@example.com', client_id: 'cl1' },
  { contact_name_id: 'c2', full_name: 'Grace Hopper', email: 'grace@example.com', client_id: 'cl1' },
] as any;

describe('MultiContactPicker Escape inside a dialog', () => {
  it('first Escape closes only the list; the next one asks to discard', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen onClose={onClose} id="host" title="Host" hasUnsavedChanges>
        <MultiContactPicker id="picker" values={[]} onValuesChange={() => {}} contacts={contacts} />
      </Dialog>,
    );

    fireEvent.click(document.getElementById('picker')!);
    const search = screen.getByPlaceholderText('Search contacts...');
    search.focus();
    fireEvent.change(search, { target: { value: 'ada' } });

    fireEvent.keyDown(search, { key: 'Escape', bubbles: true });
    expect(screen.queryByPlaceholderText('Search contacts...')).toBeNull();
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', bubbles: true });
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('auto-focuses search on open, and click + typing filters the list', async () => {
    render(
      <Dialog isOpen onClose={() => {}} id="host" title="Host" hasUnsavedChanges>
        <MultiContactPicker id="picker" values={[]} onValuesChange={() => {}} contacts={contacts} />
      </Dialog>,
    );
    fireEvent.click(document.getElementById('picker')!);
    const search = (await screen.findByPlaceholderText('Search contacts...')) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.click(search);
    fireEvent.change(search, { target: { value: 'grace' } });
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('grace');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Grace Hopper');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
  });

  it('a pointerdown on a dropdown element outside the dialog rect does not open the discard guard', async () => {
    render(
      <Dialog isOpen onClose={() => {}} id="host" title="Host" hasUnsavedChanges>
        <MultiContactPicker id="picker" values={['c1']} onValuesChange={() => {}} contacts={contacts} />
      </Dialog>,
    );
    fireEvent.click(document.getElementById('picker')!);
    const clearAll = await screen.findByText('Clear all');
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const make = (top: number, bottom: number) =>
        ({ top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
      // Dialog occupies 0-300px; everything else (the dropdown) hangs at 500-700px.
      return this === dialog ? make(0, 300) : make(500, 700);
    });
    try {
      const rect = dialog.getBoundingClientRect();
      expect(clearAll.getBoundingClientRect().top).toBeGreaterThan(rect.bottom);
      fireEvent.pointerDown(clearAll, { clientX: 100, clientY: 600, button: 0 });
      fireEvent.pointerDown(screen.getAllByRole('option')[0], { clientX: 100, clientY: 600, button: 0 });
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
