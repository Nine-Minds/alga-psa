/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
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

// A document preview opens with the file name as its title, and uploads arrive
// named like `monthly_network_inventory_export_final.txt` - one unbroken word
// that used to run straight out of the dialog.
const LONG_TITLE = 'extremely_long_client_document_name_with_no_spaces_at_all_2026_final.txt';

describe('Dialog title overflow', () => {
  afterEach(() => cleanup());

  it('wraps a long unbroken title instead of overflowing the dialog', () => {
    render(
      <Dialog isOpen onClose={vi.fn()} id="document-preview" title={LONG_TITLE}>
        <p>Preview</p>
      </Dialog>,
    );

    expect(screen.getByText(LONG_TITLE)).toHaveClass('break-words');
  });

  it('wraps a long unbroken title when nested inside another dialog', () => {
    render(
      <Dialog isOpen onClose={vi.fn()} id="documents" title="Documents">
        <Dialog isOpen onClose={vi.fn()} id="document-preview" title={LONG_TITLE}>
          <p>Preview</p>
        </Dialog>
      </Dialog>,
    );

    expect(screen.getByText(LONG_TITLE)).toHaveClass('break-words');
  });
});
