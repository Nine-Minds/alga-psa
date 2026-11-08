/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ConfirmationDialog } from './ConfirmationDialog';

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

afterEach(() => {
  cleanup();
});

const MESSAGE = 'Are you sure you want to delete template "Walkthrough Template"? This action cannot be undone.';

describe('ConfirmationDialog message rendering', () => {
  it('renders a string message exactly once', () => {
    render(
      <ConfirmationDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Template"
        message={MESSAGE}
        id="delete-template"
      />,
    );

    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it('uses the visible message as the dialog description', () => {
    render(
      <ConfirmationDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Template"
        message={MESSAGE}
        id="delete-template"
      />,
    );

    const paragraph = screen.getByText(MESSAGE);
    expect(paragraph.className).not.toContain('sr-only');
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-describedby')).toBe(paragraph.id);
  });

  it('does not repeat a node message in the description', () => {
    render(
      <ConfirmationDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Template"
        message={<div>{MESSAGE}</div>}
        id="delete-template"
      />,
    );

    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });
});
