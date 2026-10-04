// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecurringClientsSection } from '../RecurringClientsSection';
import type { RecurringDefinitionClientRecord } from '../../../lib/recurring/types';

const mocks = vi.hoisted(() => ({
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue;
    return typeof template === 'string' ? template : key;
  },
}));

vi.mock('../../../actions/recurringTicketActions', () => ({
  removeClientFromRecurringTicketDefinition: vi.fn(),
  setRecurringTicketClientActive: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en' } }),
}));
vi.mock('../AddRecurringClientsDialog', () => ({ AddRecurringClientsDialog: () => null }));
vi.mock('../RecurringClientOverridesDialog', () => ({ RecurringClientOverridesDialog: () => null }));

const client = (id: string, name: string): RecurringDefinitionClientRecord => ({
  definition_client_id: id,
  definition_id: 'def-1',
  client_id: `client-${id}`,
  client_name: name,
  is_active: true,
  overrides: {} as RecurringDefinitionClientRecord['overrides'],
  contact_id: null,
  location_id: null,
  asset_ids: [],
});

const renderSection = () => render(
  <RecurringClientsSection
    definitionId="def-1"
    clients={[client('dc-1', 'Emerald City'), client('dc-2', 'Northwind Traders')]}
    nextDueAt="2026-11-01T14:00:00.000Z"
    timeZone="UTC"
    readOnly={false}
    onChanged={vi.fn()}
  />,
);

describe('RecurringClientsSection render contract', () => {
  afterEach(() => cleanup());

  it('mounts a kebab menu for every client row', () => {
    renderSection();
    expect(document.querySelector('#recurring-client-menu-dc-1')).not.toBeNull();
    expect(document.querySelector('#recurring-client-menu-dc-2')).not.toBeNull();
    expect(document.querySelectorAll('[id^="recurring-client-menu-"]')).toHaveLength(2);
  });

  it('renders exactly one "Next due" column header', () => {
    renderSection();
    const headers = Array.from(document.querySelectorAll('thead th')).filter((th) => th.textContent?.trim() === 'Next due');
    expect(headers).toHaveLength(1);
  });

  it('opens the menu with Edit overrides and Remove', async () => {
    renderSection();
    await userEvent.click(document.querySelector('#recurring-client-menu-dc-1') as HTMLElement);
    expect(await screen.findByText('Edit overrides')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
  });
});
