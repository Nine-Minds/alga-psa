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
  getContactLocationCount: vi.fn(),
  getClientLocations: vi.fn(),
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
vi.mock('../../actions/clientLocationActions', () => ({
  getClientLocations: hoisted.getClientLocations,
}));
vi.mock('@alga-psa/clients/actions', () => ({
  updateContact: hoisted.updateContact,
  getContactLocationCount: hoisted.getContactLocationCount,
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

const triage: any = { client_id: 'triage-id', client_name: 'Unmatched Email', is_inactive: false, client_type: 'company', logoUrl: null };
const life: any = { client_id: 'life-id', client_name: 'Life Landscaping', is_inactive: false, client_type: 'company', logoUrl: null };
const inactive: any = { client_id: 'inactive-id', client_name: 'Dormant Co', is_inactive: true, client_type: 'company', logoUrl: null };
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
    hoisted.getContactLocationCount.mockResolvedValue(0);
    hoisted.getClientLocations.mockResolvedValue([
      { location_id: 'loc-warehouse', location_name: 'Warehouse', is_active: true, is_default: false },
      { location_id: 'loc-hq', location_name: 'Head office', is_active: true, is_default: true },
    ]);
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

  const linkedContact: any = {
    ...contact,
    work_arrangement: 'on_site',
    locations: [
      { location_id: 'loc-warehouse', location_name: 'Warehouse', is_primary: true, is_active: true },
      { location_id: 'loc-hq', location_name: 'Head office', is_primary: false, is_active: true },
    ],
  };

  const pickLife = async () => {
    fireEvent.click(document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement);
    fireEvent.click(await waitFor(() => {
      const option = document.querySelector('#contact-edit-client-picker-option-life-id') as HTMLElement | null;
      expect(option).toBeInTheDocument();
      return option!;
    }));
  };

  it('T029: naming the links a client change would remove, keeping the old client on cancel', async () => {
    render(
      <ContactDetailsEdit
        initialContact={linkedContact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    await pickLife();

    expect(await screen.findByText(/This removes 2 location link\(s\)\./)).toBeInTheDocument();
    // The count comes from what is on screen, so the server is not asked.
    expect(hoisted.getContactLocationCount).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('#contact-edit-location-links-confirm-close') as HTMLElement);

    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Unmatched Email')
    );
  });

  it('T029: confirming the change moves the contact and saves with no location links', async () => {
    render(
      <ContactDetailsEdit
        initialContact={linkedContact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    await pickLife();

    fireEvent.click(await waitFor(() => {
      const confirm = document.querySelector('#contact-edit-location-links-confirm-confirm') as HTMLElement | null;
      expect(confirm).toBeInTheDocument();
      return confirm!;
    }));

    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Life Landscaping')
    );

    fireEvent.click(document.querySelector('#contact-edit-save-button') as HTMLElement);

    await waitFor(() => expect(hoisted.updateContact).toHaveBeenCalledTimes(1));
    expect(hoisted.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'life-id', locations: [] })
    );
  });

  it('T030: a contact with no links changes client without a confirmation', async () => {
    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    await pickLife();

    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Life Landscaping')
    );
    // Nothing is loaded locally, so the stored count decides — and it is zero.
    expect(hoisted.getContactLocationCount).toHaveBeenCalledWith('contact-1');
    expect(screen.queryByText(/This removes/)).toBeNull();
  });

  it('confirms with the stored count when the contact was opened without its links', async () => {
    hoisted.getContactLocationCount.mockResolvedValue(3);

    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    await pickLife();

    expect(await screen.findByText(/This removes 3 location link\(s\)\./)).toBeInTheDocument();
  });

  it('does not re-ask on a second client change once the links are already dropped', async () => {
    hoisted.getContactLocationCount.mockResolvedValue(3);

    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    await pickLife();
    fireEvent.click(await waitFor(() => {
      const confirm = document.querySelector('#contact-edit-location-links-confirm-confirm') as HTMLElement | null;
      expect(confirm).toBeInTheDocument();
      return confirm!;
    }));
    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Life Landscaping')
    );

    // The stored links are already slated to go, so moving on again has nothing left to warn about.
    fireEvent.click(document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement);
    fireEvent.click(await waitFor(() => {
      const option = document.querySelector('#contact-edit-client-picker-option-inactive-id') as HTMLElement | null;
      expect(option).toBeInTheDocument();
      return option!;
    }));

    await waitFor(() =>
      expect(document.querySelector('#contact-edit-client-picker-trigger')).toHaveTextContent('Dormant Co')
    );
    expect(screen.queryByText(/This removes/)).toBeNull();
  });

  it('says nothing about locations when the contact arrived without them loaded', async () => {
    // `locations` omitted means unchanged; a form that never saw them must not speak for them.
    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    fireEvent.click(document.querySelector('#contact-edit-save-button') as HTMLElement);

    await waitFor(() => expect(hoisted.updateContact).toHaveBeenCalledTimes(1));
    expect(hoisted.updateContact.mock.calls[0]![0]).not.toHaveProperty('locations', expect.anything());
    expect(hoisted.updateContact.mock.calls[0]![0].locations).toBeUndefined();
  });

  it('sends the loaded set untouched when nothing about the links changed', async () => {
    render(
      <ContactDetailsEdit
        initialContact={linkedContact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    fireEvent.click(document.querySelector('#contact-edit-save-button') as HTMLElement);

    await waitFor(() => expect(hoisted.updateContact).toHaveBeenCalledTimes(1));
    expect(hoisted.updateContact.mock.calls[0]![0].locations).toEqual([
      { location_id: 'loc-warehouse', is_primary: true },
      { location_id: 'loc-hq', is_primary: false },
    ]);
  });
});
