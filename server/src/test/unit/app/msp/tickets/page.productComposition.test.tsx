import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();
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
}));

vi.mock('@alga-psa/msp-composition/tickets', () => ({
  MspTicketsPageClient: MspTicketsPageClientMock,
}));

const { default: TicketsPage } = await import('server/src/app/msp/tickets/page');

describe('MSP tickets page product composition', () => {
  const getRenderedTicketsClientProps = async (search: Record<string, string>) => {
    const result = await TicketsPage({ searchParams: Promise.resolve(search) });
    const pageContainer = result as React.ReactElement<{ children: React.ReactElement }>;
    const ticketsClientElement = pageContainer.props.children as React.ReactElement;
    return ticketsClientElement.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    getCurrentUserPermissionsMock.mockResolvedValue(['ticket:update']);
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

  it('T008: disables SLA status filter composition for Algadesk tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const passedProps = await getRenderedTicketsClientProps({
      slaStatusFilter: 'breached',
      statusId: 'open',
    });

    expect(passedProps.allowSlaStatusFilter).toBe(false);
    expect(passedProps.useAlgadeskQuickAddForm).toBe(true);
    expect((passedProps.initialFilters as Record<string, unknown>).slaStatusFilter).toBeUndefined();
  });

  it('keeps SLA status filter composition for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const passedProps = await getRenderedTicketsClientProps({
      slaStatusFilter: 'breached',
    });

    expect(passedProps.allowSlaStatusFilter).toBe(true);
    expect(passedProps.useAlgadeskQuickAddForm).toBe(false);
    expect((passedProps.initialFilters as Record<string, unknown>).slaStatusFilter).toBe('breached');
  });
});
