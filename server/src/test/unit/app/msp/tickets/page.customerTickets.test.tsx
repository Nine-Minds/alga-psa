import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

/**
 * T022/T023 (2026-10-14 amendment): All Tickets stays the native page and
 * carries no co-managed state; legacy `?queueView=` links move to Customer
 * Tickets; Customer Tickets sits behind the release boundary.
 */

const redirectMock = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); });
const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();
const getUserPreferenceMock = vi.fn();
const getCurrentTenantProductMock = vi.fn();
const getConsolidatedTicketListDataMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();
const getTeamsMock = vi.fn();

function MspTicketsPageClientMock() { return null; }

vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
  getCurrentUserPermissions: getCurrentUserPermissionsMock,
  getUserPreference: getUserPreferenceMock,
}));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: getCurrentTenantProductMock }));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({ getConsolidatedTicketListData: getConsolidatedTicketListDataMock }));
vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({ getTicketingDisplaySettings: getTicketingDisplaySettingsMock }));
vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: getTeamsMock,
  isTeamActionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'error' in value),
}));
vi.mock('@alga-psa/msp-composition/tickets/MspTicketsPageClient', () => ({ default: MspTicketsPageClientMock }));
vi.mock('@/components/co-managed/QualifiedTicketList', () => ({
  default: function QualifiedTicketListMock() { return null; },
}));

const { default: TicketsPage } = await import('server/src/app/msp/tickets/page');
const { default: CustomerTicketsPage } = await import('server/src/app/msp/tickets/customer/page');
const { CoManagedCalloutStrip } = await import('server/src/components/co-managed/CoManagedCalloutStrip');
const QualifiedTicketList = (await import('@/components/co-managed/QualifiedTicketList')).default;
const { CoManagedFeatureBoundary } = await import('server/src/components/co-managed/CoManagedFeatureBoundary');

const redirectedTo = async (search: Record<string, string>) => {
  try {
    await TicketsPage({ searchParams: Promise.resolve(search) });
  } catch (error) {
    const match = /^NEXT_REDIRECT:(.*)$/.exec((error as Error).message);
    if (match) return match[1];
    throw error;
  }
  return null;
};

const renderedNativeProps = async (search: Record<string, string>, product = 'psa') => {
  getCurrentTenantProductMock.mockResolvedValue(product);
  const result = await TicketsPage({ searchParams: Promise.resolve(search) }) as React.ReactElement<{ children: React.ReactNode }>;
  const client = React.Children.toArray(result.props.children).find(
    (child): child is React.ReactElement<Record<string, any>> => React.isValidElement(child) && child.type === MspTicketsPageClientMock,
  );
  if (!client) throw new Error('native list was not rendered');
  return client.props;
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
  getCurrentUserPermissionsMock.mockResolvedValue(['ticket:update']);
  getUserPreferenceMock.mockResolvedValue(null);
  getConsolidatedTicketListDataMock.mockResolvedValue({
    tickets: [], totalCount: 0,
    options: { boardOptions: [], statusOptions: [], priorityOptions: [], categories: [], clients: [], users: [], tags: [] },
    metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
  });
  getTicketingDisplaySettingsMock.mockResolvedValue({ responseStateTrackingEnabled: true });
  getTeamsMock.mockResolvedValue([]);
});

describe('T022 — legacy qualified URLs on /msp/tickets', () => {
  it('redirects queueView links to Customer Tickets with the supported params', async () => {
    expect(await redirectedTo({ queueView: 'working', workspace: 'all' })).toBe('/msp/tickets/customer?queueView=working&workspace=all');
    expect(await redirectedTo({ queueView: 'oversight', queueState: 'closed', searchQuery: 'vpn' }))
      .toBe('/msp/tickets/customer?queueView=oversight&workspace=all&searchQuery=vpn&queueState=closed');
    expect(getConsolidatedTicketListDataMock).not.toHaveBeenCalled();
  });

  it('sends the retired "This MSP" workspace to native All Tickets with no qualified params', async () => {
    expect(await redirectedTo({ queueView: 'working', workspace: 'msp' })).toBe('/msp/tickets');
    expect(await redirectedTo({ queueView: 'working', workspace: 'msp', boardIds: 'b1' })).toBe('/msp/tickets?boardIds=b1');
  });

  it('renders native All Tickets when there is no queueView', async () => {
    expect(await redirectedTo({ boardIds: 'b1' })).toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('T023 — All Tickets carries no co-managed state', () => {
  it('passes no scope bar, qualified scope or co-managed props to the native list', async () => {
    const props = await renderedNativeProps({});
    for (const key of ['scopeControls', 'qualifiedScope', 'scope', 'queueView', 'workspace']) {
      expect(props).not.toHaveProperty(key);
    }
    expect(props.initialFilters).not.toHaveProperty('queueView');
    expect(getConsolidatedTicketListDataMock).toHaveBeenCalledTimes(1);
  });

  it('mounts the lazy callout slot only for PSA tenants, behind the release boundary', async () => {
    const psa = await renderedNativeProps({}, 'psa');
    const callout = psa.listCallout as React.ReactElement;
    expect(callout.type).toBe(CoManagedCalloutStrip);
    const algadesk = await renderedNativeProps({}, 'algadesk');
    expect(algadesk.listCallout).toBeUndefined();
  });
});

describe('T022 — Customer Tickets route', () => {
  const body = async (search: Record<string, string> = {}) => {
    const page = await CustomerTicketsPage({ searchParams: Promise.resolve(search) }) as React.ReactElement<{ children: React.ReactElement }>;
    const boundary = page.props.children;
    expect(boundary.type).toBe(CoManagedFeatureBoundary);
    return boundary.props.children as React.ReactElement<Record<string, any>>;
  };

  it('defaults to the working queue across all workspaces and parses qualified params', async () => {
    const list = await body();
    expect(list.type).toBe(QualifiedTicketList);
    expect(list.props.scope).toEqual({ kind: 'qualified', view: 'working', workspace: 'all' });
    const filtered = await body({ queueView: 'oversight', workspace: '1f98df77-0000-4000-8000-000000000001', clientId: 'c1', signal: 'awaiting_reply' });
    expect(filtered.props.scope).toMatchObject({ view: 'oversight', workspace: { tenant: '1f98df77-0000-4000-8000-000000000001' } });
    expect(filtered.props.initialPresentation).toMatchObject({ clientId: 'c1', signal: 'awaiting_reply' });
  });

  it('treats the retired workspace=msp as all workspaces', async () => {
    const list = await body({ queueView: 'working', workspace: 'msp' });
    expect(list.props.scope.workspace).toBe('all');
  });

  it('renders an unavailable fallback when the release boundary is off, not a blank route', async () => {
    const page = await CustomerTicketsPage({ searchParams: Promise.resolve({}) }) as React.ReactElement<{ children: React.ReactElement }>;
    expect(page.props.children.props.fallback).toBeTruthy();
  });

  it('has no gating on assignments: a user with none still gets the page (the reader answers empty)', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'unassigned', tenant: 'tenant-1' });
    const list = await body();
    expect(list.props.actorScope).toBe('tenant-1:unassigned');
  });
});
