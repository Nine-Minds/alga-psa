/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import englishCommon from '../../../../public/locales/en/common.json';
import germanCommon from '../../../../public/locales/de/common.json';
import spanishCommon from '../../../../public/locales/es/common.json';
import { ListFilterChips } from '@alga-psa/ui/components/ListToolbar';

const i18n = createInstance();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: (namespace: string) => ({ t: i18n.getFixedT(null, namespace) }),
}));

beforeEach(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
    resources: { en: { common: englishCommon }, de: { common: germanCommon }, es: { common: spanishCommon } },
  });
});

afterEach(cleanup);

it('translates the remove action when the locale changes and preserves the filter label and handler', async () => {
  const onRemove = vi.fn();
  const chips = [{ key: 'client', label: 'R&D', removeId: 'remove-client-filter', onRemove }];
  const { rerender } = render(<ListFilterChips chips={chips} />);
  expect(screen.getByRole('button', { name: 'Remove R&D' })).toBeTruthy();

  await i18n.changeLanguage('de');
  rerender(<ListFilterChips chips={chips} />);
  const remove = screen.getByRole('button', { name: 'R&D entfernen' });
  expect(remove.id).toBe('remove-client-filter');
  expect(screen.getByText('R&D')).toBeTruthy();
  fireEvent.click(remove);
  expect(onRemove).toHaveBeenCalledOnce();
});

it('uses the Spanish default while honoring a caller-provided accessible label', async () => {
  await i18n.changeLanguage('es');
  render(<ListFilterChips chips={[
    { key: 'client', label: 'Acme', onRemove: vi.fn() },
    { key: 'status', label: 'Abierto', removeLabel: 'Quitar filtro de estado', onRemove: vi.fn() },
  ]} />);
  expect(screen.getByRole('button', { name: 'Eliminar Acme' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quitar filtro de estado' })).toBeTruthy();
});
