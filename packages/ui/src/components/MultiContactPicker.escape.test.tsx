/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
