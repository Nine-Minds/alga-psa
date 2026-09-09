import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();
const getUserPreferenceMock = vi.fn();
const getCurrentTenantProductMock = vi.fn();
const getConsolidatedTicketListDataMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();
const getTeamsMock = vi.fn();

function MspTicketsPageClientMock() {
  return null;
}

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
  getCurrentUserPermissions: getCurrentUserPermissionsMock,
  getUserPreference: getUserPreferenceMock,
}));

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketListData: getConsolidatedTicketListDataMock,
}));

vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: getTicketingDisplaySettingsMock,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: getTeamsMock,
  isTeamActionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'error' in value),
}));

vi.mock('@alga-psa/msp-composition/tickets/MspTicketsPageClient', () => ({
  default: MspTicketsPageClientMock,
}));

const { default: TicketsPage } = await import('server/src/app/msp/tickets/page');

describe('MSP tickets page product composition', () => {
  // The page container also renders product-scoped siblings (the co-managed
  // queue link), so the list client is found by identity, not by position.
  const getRenderedTicketsClientProps = async (search: Record<string, string>) => {
    const result = await TicketsPage({ searchParams: Promise.resolve(search) });
    const pageContainer = result as React.ReactElement<{ children: React.ReactNode }>;
    const ticketsClientElement = React.Children.toArray(pageContainer.props.children).find(
      (child): child is React.ReactElement<Record<string, unknown>> =>
        React.isValidElement(child) && child.type === MspTicketsPageClientMock,
    );
    if (!ticketsClientElement) {
      throw new Error('the tickets page did not render MspTicketsPageClient');
    }
    return ticketsClientElement.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    getCurrentUserPermissionsMock.mockResolvedValue(['ticket:update']);
    getUserPreferenceMock.mockResolvedValue(null);
    getConsolidatedTicketListDataMock.mockResolvedValue({
      tickets: [],
      totalCount: 0,
      options: {
        boardOptions: [],
        statusOptions: [],
        priorityOptions: [],
        categories: [],
        clients: [],
        users: [],
        tags: [],
      },
      metadata: {
        agentAvatarUrls: {},
        teamAvatarUrls: {},
        ticketTags: {},
      },
    });
    getTicketingDisplaySettingsMock.mockResolvedValue({ responseStateTrackingEnabled: true });
    getTeamsMock.mockResolvedValue([]);
  });

  it('T008: disables SLA status filter composition for AlgaDesk tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const passedProps = await getRenderedTicketsClientProps({
      slaStatusFilter: 'breached',
      statusId: 'open',
    });

    expect(passedProps.allowSlaStatusFilter).toBe(false);
    expect(passedProps.useAlgaDeskQuickAddForm).toBe(true);
    expect((passedProps.initialFilters as Record<string, unknown>).slaStatusFilter).toBeUndefined();
  });

  it('keeps SLA status filter composition for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const passedProps = await getRenderedTicketsClientProps({
      slaStatusFilter: 'breached',
    });

    expect(passedProps.allowSlaStatusFilter).toBe(true);
    expect(passedProps.useAlgaDeskQuickAddForm).toBe(false);
    expect((passedProps.initialFilters as Record<string, unknown>).slaStatusFilter).toBe('breached');
  });
});
