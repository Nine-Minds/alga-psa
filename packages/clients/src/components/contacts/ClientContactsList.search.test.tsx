/**
 * @vitest-environment jsdom
 *
 * alga-2026-0002713: a client's Contacts tab must find a contact by its note
 * text — the plain-text notes column instantly, and rich-text notes (which live
 * in a document, not on the contact row) through the indexed search.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientContactsList from './ClientContactsList';

const hoisted = vi.hoisted(() => ({
  getContactsByClient: vi.fn(),
  getContactByContactNameId: vi.fn(),
  getAllClients: vi.fn(),
  searchContactListIds: vi.fn(),
  getCurrentUserAsync: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

// `t` must be referentially stable: the component lists it as an effect dependency.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/clients/actions', () => ({
  getContactsByClient: hoisted.getContactsByClient,
  getContactByContactNameId: hoisted.getContactByContactNameId,
  getAllClients: hoisted.getAllClients,
  searchContactListIds: hoisted.searchContactListIds,
}));

vi.mock('../../lib/usersHelpers', () => ({
  getCurrentUserAsync: hoisted.getCurrentUserAsync,
}));

vi.mock('./ContactDetailsEdit', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByEntity: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data }: any) => (
    <div>
      {data.map((row: any) => (
        <div key={row.id} data-testid={`row-${row.contact_name_id}`}>{row.full_name}</div>
      ))}
    </div>
  ),
}));
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Trigger: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children }: any) => <button type="button">{children}</button>,
}));

const emerald: any = { client_id: 'emerald-id', client_name: 'Emerald City', is_inactive: false, location_country_code: 'US' };

const zelda: any = {
  contact_name_id: 'contact-zelda',
  full_name: 'Zelda Searchproof',
  email: 'zelda@emeraldcity.oz',
  role: 'Coordinator',
  notes: 'Sunopal coordinator for after-hours support. Prefers coffee.',
  client_id: 'emerald-id',
  phone_numbers: [{ phone_number: '+61 433 521 762', is_default: true }],
};

const dorothy: any = {
  contact_name_id: 'contact-dorothy',
  full_name: 'Dorothy Gale',
  email: 'dorothy@oz.com',
  role: 'Owner',
  notes: null,
  client_id: 'emerald-id',
  phone_numbers: [{ phone_number: '+1-555-987-6543', is_default: true }],
};

const renderList = () => render(<ClientContactsList clientId="emerald-id" client={emerald} />);

const typeSearch = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText('Search contacts...'), { target: { value } });
};

describe('ClientContactsList search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getContactsByClient.mockResolvedValue([zelda, dorothy]);
    hoisted.getAllClients.mockResolvedValue([emerald]);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
    hoisted.searchContactListIds.mockResolvedValue([]);
  });

  it('matches the plain-text notes column without waiting for the server', async () => {
    renderList();
    await screen.findByTestId('row-contact-zelda');

    typeSearch('coffee');

    expect(screen.getByTestId('row-contact-zelda')).toBeInTheDocument();
    expect(screen.queryByTestId('row-contact-dorothy')).not.toBeInTheDocument();
  });

  it('keeps matching notes across words and letter case', async () => {
    renderList();
    await screen.findByTestId('row-contact-zelda');

    typeSearch('After-Hours Support');

    expect(screen.getByTestId('row-contact-zelda')).toBeInTheDocument();
    expect(screen.queryByTestId('row-contact-dorothy')).not.toBeInTheDocument();
  });

  it('includes contacts the indexed search matches, e.g. rich-text note documents', async () => {
    hoisted.searchContactListIds.mockResolvedValue(['contact-dorothy']);
    renderList();
    await screen.findByTestId('row-contact-zelda');

    typeSearch('ruby slippers');

    // Nothing on the row text matches, so the row only appears once the indexed
    // search (debounced) answers.
    expect(screen.queryByTestId('row-contact-dorothy')).not.toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByTestId('row-contact-dorothy')).toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(hoisted.searchContactListIds).toHaveBeenCalledWith('ruby slippers');
    expect(screen.queryByTestId('row-contact-zelda')).not.toBeInTheDocument();
  });

  it('matches trailing phone digits regardless of formatting', async () => {
    renderList();
    await screen.findByTestId('row-contact-zelda');

    typeSearch('521 762');

    expect(screen.getByTestId('row-contact-zelda')).toBeInTheDocument();
    expect(screen.queryByTestId('row-contact-dorothy')).not.toBeInTheDocument();
  });

  it('still shows every contact once the search box is cleared', async () => {
    renderList();
    await screen.findByTestId('row-contact-zelda');

    typeSearch('coffee');
    expect(screen.queryByTestId('row-contact-dorothy')).not.toBeInTheDocument();

    typeSearch('');
    expect(screen.getByTestId('row-contact-zelda')).toBeInTheDocument();
    expect(screen.getByTestId('row-contact-dorothy')).toBeInTheDocument();
  });
});
