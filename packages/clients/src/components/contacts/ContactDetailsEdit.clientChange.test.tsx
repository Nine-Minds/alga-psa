/**
 * @vitest-environment jsdom
 *
 * alga0002338: starting from a contact on the inbound triage client, the real
 * ClientPicker in the edit form must list the other clients (inactive ones too,
 * because the picker's filter is "all") and saving must send the new client_id.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const triage: any = { client_id: 'triage-id', client_name: 'Unmatched Email', is_inactive: false, client_type: 'company' };
const life: any = { client_id: 'life-id', client_name: 'Life Landscaping', is_inactive: false, client_type: 'company' };
const inactive: any = { client_id: 'inactive-id', client_name: 'Dormant Co', is_inactive: true, client_type: 'company' };

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

describe('ContactDetailsEdit client change', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updateContact.mockImplementation(async (input: any) => input);
  });

  it('lists the other clients, including inactive ones, when editing a contact on the triage client', async () => {
    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    const trigger = document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement;
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Unmatched Email');

    fireEvent.click(trigger);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(document.querySelector('#contact-edit-client-picker-option-triage-id')).toBeInTheDocument();
    expect(document.querySelector('#contact-edit-client-picker-option-life-id')).toBeInTheDocument();
    expect(document.querySelector('#contact-edit-client-picker-option-inactive-id')).toBeInTheDocument();
  });

  it('saves the newly selected client as client_id', async () => {
    render(
      <ContactDetailsEdit
        initialContact={contact}
        clients={[triage, life, inactive]}
        onSave={onSave}
        onCancel={onCancel}
        isInDrawer
      />
    );

    fireEvent.click(document.querySelector('#contact-edit-client-picker-trigger') as HTMLElement);
    fireEvent.click(await waitFor(() => {
      const option = document.querySelector('#contact-edit-client-picker-option-life-id') as HTMLElement | null;
      expect(option).toBeInTheDocument();
      return option!;
    }));

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
