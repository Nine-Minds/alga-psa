/**
 * @vitest-environment jsdom
 *
 * T038: where a person works reads beside their tag badges — in the option rows and on the closed
 * trigger. A contact with no links and no remote marker reads as nothing rather than borrowing the
 * client's default, which is the dispatcher's call to make.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IContact } from '@alga-psa/types';
import { ContactPicker } from '../ContactPicker';

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const contact = (overrides: Partial<IContact>): IContact => ({
  contact_name_id: 'contact-1',
  full_name: 'Dorothy Gale',
  client_id: 'acme',
  phone_numbers: [],
  email: 'dorothy@acme.test',
  date_created: '',
  date_updated: '',
  is_inactive: false,
  tenant: 'tenant-1',
  ...overrides,
} as IContact);

const contacts: IContact[] = [
  contact({
    contact_name_id: 'dorothy',
    full_name: 'Dorothy Gale',
    displayTags: [{ tag_id: 'tag-1', tag_text: 'VIP', background_color: null, text_color: null }] as any,
    locations: [
      { location_id: 'loc-1', location_name: 'Warehouse', is_primary: true },
      { location_id: 'loc-2', location_name: 'Head office', is_primary: false },
    ] as any,
  }),
  contact({ contact_name_id: 'toto', full_name: 'Toto', work_arrangement: 'remote' } as any),
  contact({ contact_name_id: 'oz', full_name: 'Oz' }),
];

const renderPicker = (value = '') =>
  render(
    <ContactPicker
      id="requester-picker"
      contacts={contacts}
      value={value}
      onValueChange={vi.fn()}
      clientId="acme"
    />,
  );

describe('ContactPicker locations', () => {
  it('shows the primary location, the extra-site count and Remote in the option rows', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Select Contact|Dorothy/i }));

    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    const hint = (contactId: string) =>
      document.querySelector(`[data-contact-location="${contactId}"]`)?.textContent?.trim() ?? null;

    expect(hint('dorothy')).toBe('· Warehouse +1');
    expect(hint('toto')).toBe('· Remote');
    // Neither linked nor remote: nothing to say.
    expect(hint('oz')).toBeNull();
    // The tag badge still renders in the same row.
    expect(screen.getByText('VIP')).toBeTruthy();
  });

  it('repeats the hint on the closed trigger for the selected contact', async () => {
    const { rerender } = renderPicker('dorothy');

    await waitFor(() =>
      expect(document.querySelector('[data-contact-location-selected]')?.textContent).toBe('Warehouse +1'),
    );

    rerender(
      <ContactPicker id="requester-picker" contacts={contacts} value="oz" onValueChange={vi.fn()} clientId="acme" />,
    );
    await waitFor(() => expect(document.querySelector('[data-contact-location-selected]')).toBeNull());
  });
});
