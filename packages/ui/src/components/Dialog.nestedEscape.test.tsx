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

function renderNested({ nestedOpen }: { nestedOpen: boolean }) {
  const onCloseParent = vi.fn();
  const onCloseNested = vi.fn();

  render(
    <Dialog isOpen onClose={onCloseParent} id="apply-branding" title="Apply branding">
      <button type="button">Apply</button>
      <Dialog isOpen={nestedOpen} onClose={onCloseNested} id="template-preview" title="Preview">
        <button type="button">Done</button>
      </Dialog>
    </Dialog>,
  );

  return { onCloseParent, onCloseNested };
}

const pressEscape = (target: Element | Document = document) =>
  fireEvent.keyDown(target, { key: 'Escape', bubbles: true });

const nestedButton = () => {
  const button = document.querySelector('[data-automation-id="template-preview-dialog"] button');
  if (!button) throw new Error('nested dialog not rendered');
  return button;
};

describe('Escape inside a nested dialog', () => {
  afterEach(() => cleanup());

  it('closes only the nested dialog, leaving the one it opened from', () => {
    const { onCloseParent, onCloseNested } = renderNested({ nestedOpen: true });

    pressEscape(nestedButton());

    expect(onCloseNested).toHaveBeenCalledTimes(1);
    expect(onCloseParent).not.toHaveBeenCalled();
  });

  it('still closes the outer dialog once nothing is nested inside it', () => {
    const { onCloseParent } = renderNested({ nestedOpen: false });

    pressEscape();

    expect(onCloseParent).toHaveBeenCalledTimes(1);
  });
});
