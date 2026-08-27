import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getAllContactsMock = vi.fn();
const getAllClientsMock = vi.fn();
const loadMspInteractionsPageDataMock = vi.fn();

function ContactsLayoutMock() {
  return null;
}

function InteractionsPageWorkspaceMock() {
  return null;
}

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: getAllContactsMock,
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/clients', () => ({
  ContactsLayout: ContactsLayoutMock,
}));

vi.mock('@alga-psa/msp-composition/clients/loadMspInteractionsPageData', () => ({
  loadMspInteractionsPageData: loadMspInteractionsPageDataMock,
}));

vi.mock('server/src/app/msp/interactions/InteractionsPageWorkspace', () => ({
  default: InteractionsPageWorkspaceMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

const { default: ContactsPage } = await import('server/src/app/msp/contacts/page');
const {
  default: InteractionsPage,
  generateMetadata,
} = await import('server/src/app/msp/interactions/page');

const contacts = [
  { contact_name_id: 'contact-1', full_name: 'Dorothy Gale' },
  { contact_name_id: 'contact-1', full_name: 'Duplicate Dorothy' },
  { contact_name_id: 'contact-2', full_name: 'Toto' },
];
const users = [{ user_id: 'user-1', first_name: 'Gale' }];
const clients = [{ client_id: 'client-1', client_name: 'Emerald City' }];
const availableOverview = {
  success: true,
  available: true,
  canManage: false,
  canResolve: true,
  providers: [],
  recentCalls: [],
  unresolvedCalls: [],
};

describe('MSP contacts and interactions page composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllContactsMock.mockResolvedValue(contacts);
    getAllClientsMock.mockResolvedValue(clients);
    loadMspInteractionsPageDataMock.mockResolvedValue({
      users,
      contacts: [contacts[1], contacts[2]],
      clients,
      telephonyOverview: availableOverview,
    });
  });

  it('keeps the contacts route focused on the deduplicated contact list', async () => {
    const result = await ContactsPage();

    expect(result.type).toBe(ContactsLayoutMock);
    expect(result.props).toEqual({
      uniqueContacts: [contacts[1], contacts[2]],
    });
    expect(getAllContactsMock).toHaveBeenCalledWith('all');
    expect(getAllClientsMock).not.toHaveBeenCalled();
    expect(loadMspInteractionsPageDataMock).not.toHaveBeenCalled();
  });

  it('loads the interaction workspace through MSP composition', async () => {
    const result = await InteractionsPage();

    expect(result.type).toBe(InteractionsPageWorkspaceMock);
    expect(result.props.users).toBe(users);
    expect(result.props.clients).toBe(clients);
    expect(result.props.contacts).toEqual([contacts[1], contacts[2]]);
    expect(result.props.telephonyOverview).toBe(availableOverview);
    expect(loadMspInteractionsPageDataMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { success: true, available: false },
    { success: false, available: false },
    null,
  ])('omits the calls surface when telephony cannot be used: %j', async (overview) => {
    const telephonyOverview = overview === null ? null : {
      ...availableOverview,
      ...overview,
    };
    loadMspInteractionsPageDataMock.mockResolvedValue({
      users,
      contacts: [contacts[1], contacts[2]],
      clients,
      telephonyOverview,
    });

    const result = await InteractionsPage();

    expect(result.type).toBe(InteractionsPageWorkspaceMock);
    expect(result.props.telephonyOverview).toBe(telephonyOverview);
  });

  it('provides translated metadata for the new route', async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: 'Interactions' });
  });
});
