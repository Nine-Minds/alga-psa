/**
 * @vitest-environment jsdom
 *
 * alga0002338: starting from a contact on the inbound triage client, the real
 * ClientPicker in the edit form must list the other clients (inactive ones too,
 * because the picker's filter is "all") and saving must send the new client_id.
 *
 * The picker is the async one: it gets its options from the context searcher (the
 * server search in the app), not from a list passed by the caller.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPickerSearchProvider } from '@alga-psa/ui/context/ClientPickerSearchContext';
import { ClientTagsProvider } from '@alga-psa/ui/context/ClientTagsContext';
import ContactDetailsEdit from './ContactDetailsEdit';

const hoisted = vi.hoisted(() => ({
  updateContact: vi.fn(),
}));

// `t` must be referentially stable: the form lists it as an effect dependency.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
    let text = options?.defaultValue ?? key;
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});

// Side-loads the form makes on mount.
vi.mock('@alga-psa/clients/actions', () => ({
  updateContact: hoisted.updateContact,
  listInboundTicketDestinationOptions: vi.fn().mockResolvedValue([]),
  getAllCountries: vi.fn().mockResolvedValue([]),
  getTenantDefaultCountry: vi.fn().mockResolvedValue(null),
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue([]),
  getCustomPhoneTypeUsageCount: vi.fn().mockResolvedValue(0),
  deleteOrphanedPhoneTypes: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityIds: vi.fn().mockResolvedValue([]),
  isTagActionError: () => false,
}));
vi.mock('@alga-psa/tags/context', () => ({ useTags: () => ({ tags: [] }) }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('../../lib/usersHelpers', () => ({
  getContactAvatarUrlActionAsync: vi.fn().mockResolvedValue(null),
}));
vi.mock('./ContactAvatarUpload', () => ({ default: () => null }));

const triage = { client_id: 'triage-id', client_name: 'Unmatched Email', is_inactive: false, client_type: 'company', logoUrl: null };
const life = { client_id: 'life-id', client_name: 'Life Landscaping', is_inactive: false, client_type: 'company', logoUrl: null };
const inactive = { client_id: 'inactive-id', client_name: 'Dormant Co', is_inactive: true, client_type: 'company', logoUrl: null };
const tenantClients = [triage, life, inactive];

// Stand-in for searchClientsForPicker: honours `ids` hydration, otherwise returns everything.
const searchClients = vi.fn(async (params?: { ids?: string[] }) => {
  const rows = params?.ids ? tenantClients.filter((c) => params.ids!.includes(c.client_id)) : tenantClients;
  return { clients: rows, total: rows.length };
});

const renderEdit = () =>
  render(
    <ClientTagsProvider value={{ fetchClientTags: async () => [], fetchClientTagOptions: async () => [] }}>
      <ClientPickerSearchProvider value={{ searchClients }}>
        <ContactDetailsEdit
          initialContact={contact}
          onSave={onSave}
          onCancel={onCancel}
          isInDrawer
        />
      </ClientPickerSearchProvider>
    </ClientTagsProvider>
  );

const contact: any = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Brian Linscott',
  email: 'brian@example.com',
  client_id: 'triage-id',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
};

const onSave = vi.fn();
const onCancel = vi.fn();

describe('ContactDetailsEdit client change', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updateContact.mockImplementation(async (input: any) => input);
  });

  it('lists the other clients, including inactive ones, when editing a contact on the triage client', async () => {
    renderEdit();

    const trigger = document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement;
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveTextContent('Unmatched Email'));

    fireEvent.click(trigger);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(await screen.findByText('Life Landscaping')).toBeInTheDocument();
    expect(await screen.findByText('Dormant Co')).toBeInTheDocument();
    // Never a caller-supplied list: every call is a search or an id hydration.
    expect(searchClients).toHaveBeenCalled();
  });

  it('saves the newly selected client as client_id', async () => {
    renderEdit();

    fireEvent.click(document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement);
    fireEvent.click(await screen.findByText('Life Landscaping'));

    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Life Landscaping')
    );

    fireEvent.click(document.querySelector('#contact-edit-save-button') as HTMLElement);

    await waitFor(() => expect(hoisted.updateContact).toHaveBeenCalledTimes(1));
    expect(hoisted.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ contact_name_id: 'contact-1', client_id: 'life-id' })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'life-id' })));
  });
});
