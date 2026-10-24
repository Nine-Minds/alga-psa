/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import englishTickets from '../../../../public/locales/en/features/tickets.json';
import germanTickets from '../../../../public/locales/de/features/tickets.json';
import spanishTickets from '../../../../public/locales/es/features/tickets.json';
import { ListFilterChips } from '@alga-psa/ui/components/ListToolbar';

const i18n = createInstance();

beforeEach(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { features: englishTickets },
      de: { features: germanTickets },
      es: { features: spanishTickets },
    },
  });
});

afterEach(cleanup);

it('renders the translated label the caller supplies and preserves the filter label, id and handler', async () => {
  const onRemove = vi.fn();
  const chips = [{
    key: 'client',
    label: 'R&D',
    removeId: 'remove-client-filter',
    removeLabel: String(i18n.t('filters.removeFilterChip', { ns: 'features', label: 'R&D' })),
    onRemove,
  }];
  const { rerender } = render(<ListFilterChips chips={chips} />);
  expect(screen.getByRole('button', { name: 'Remove filter: R&D' })).toBeTruthy();

  await i18n.changeLanguage('de');
  rerender(<ListFilterChips chips={[{
    ...chips[0],
    removeLabel: String(i18n.t('filters.removeFilterChip', { ns: 'features', label: 'R&D' })),
  }]} />);
  const remove = screen.getByRole('button', { name: 'Filter entfernen: R&D' });
  expect(remove.id).toBe('remove-client-filter');
  expect(screen.getByText('R&D')).toBeTruthy();
  fireEvent.click(remove);
  expect(onRemove).toHaveBeenCalledOnce();
});

it('honors a distinct caller-provided accessible name per chip', async () => {
  await i18n.changeLanguage('es');
  render(<ListFilterChips chips={[
    { key: 'client', label: 'Acme', removeLabel: String(i18n.t('filters.removeFilterChip', { ns: 'features', label: 'Acme' })), onRemove: vi.fn() },
    { key: 'status', label: 'Abierto', removeLabel: 'Quitar filtro de estado', onRemove: vi.fn() },
  ]} />);
  expect(screen.getByRole('button', { name: 'Quitar filtro: Acme' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quitar filtro de estado' })).toBeTruthy();
});
