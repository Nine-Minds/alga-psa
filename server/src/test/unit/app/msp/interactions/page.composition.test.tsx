import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getAllContactsMock = vi.fn();
const getAllClientsMock = vi.fn();
const getAllUsersBasicMock = vi.fn();
const getTelephonyOverviewMock = vi.fn();

function ContactsLayoutMock() {
  return null;
}

function InteractionsWorkspaceMock() {
  return null;
}

function TelephonyCallsPanelMock() {
  return null;
}

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: getAllContactsMock,
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic: getAllUsersBasicMock,
}));

vi.mock('@alga-psa/integrations/actions/integrations/telephonyActions', () => ({
  getTelephonyOverview: getTelephonyOverviewMock,
}));

vi.mock('@alga-psa/clients', () => ({
  ContactsLayout: ContactsLayoutMock,
  InteractionsWorkspace: InteractionsWorkspaceMock,
}));

vi.mock('@alga-psa/integrations/components/telephony/TelephonyCallsPanel', () => ({
  default: TelephonyCallsPanelMock,
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
    getAllUsersBasicMock.mockResolvedValue(users);
    getTelephonyOverviewMock.mockResolvedValue(availableOverview);
  });

  it('keeps the contacts route focused on the deduplicated contact list', async () => {
    const result = await ContactsPage();

    expect(result.type).toBe(ContactsLayoutMock);
    expect(result.props).toEqual({
      uniqueContacts: [contacts[1], contacts[2]],
    });
    expect(getAllContactsMock).toHaveBeenCalledWith('all');
    expect(getAllClientsMock).not.toHaveBeenCalled();
    expect(getAllUsersBasicMock).not.toHaveBeenCalled();
    expect(getTelephonyOverviewMock).not.toHaveBeenCalled();
  });

  it('loads the interaction workspace and composes available calls from the server overview', async () => {
    const result = await InteractionsPage();
    const callsPanel = result.props.callsPanel as React.ReactElement;

    expect(result.type).toBe(InteractionsWorkspaceMock);
    expect(result.props.users).toBe(users);
    expect(result.props.clients).toBe(clients);
    expect(result.props.contacts).toEqual([contacts[1], contacts[2]]);
    expect(getAllContactsMock).toHaveBeenCalledWith('all');
    expect(getAllUsersBasicMock).toHaveBeenCalledWith(true);
    expect(getAllClientsMock).toHaveBeenCalledWith(true);
    expect(callsPanel.type).toBe(TelephonyCallsPanelMock);
    expect(callsPanel.props).toMatchObject({
      variant: 'operational',
      initialOverview: availableOverview,
      showHeading: false,
    });
  });

  it.each([
    { success: true, available: false },
    { success: false, available: false },
    null,
  ])('omits the calls surface when telephony cannot be used: %j', async (overview) => {
    if (overview === null) {
      getTelephonyOverviewMock.mockRejectedValue(new Error('overview failed'));
    } else {
      getTelephonyOverviewMock.mockResolvedValue({
        ...availableOverview,
        ...overview,
      });
    }

    const result = await InteractionsPage();

    expect(result.type).toBe(InteractionsWorkspaceMock);
    expect(result.props.callsPanel).toBeUndefined();
  });

  it('provides translated metadata for the new route', async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: 'Interactions' });
  });
});
