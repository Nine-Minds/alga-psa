import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundaryNode = <div data-testid="boundary">blocked</div>;

const enforceServerProductRouteMock = vi.fn();
const getProjectsMock = vi.fn();
const getAllClientsForProjectsMock = vi.fn();
const listRequestServiceCatalogGroupsActionMock = vi.fn();
const listMyRecentServiceRequestsActionMock = vi.fn();

vi.mock('@/lib/serverProductRouteGuard', () => ({
  enforceServerProductRoute: enforceServerProductRouteMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({ t: (key: string) => key }),
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProjects: getProjectsMock,
  getAllClientsForProjects: getAllClientsForProjectsMock,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityIds: vi.fn().mockResolvedValue([]),
  findAllTagsByType: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/projects/components/Projects', () => ({
  default: () => <div data-testid="projects" />,
}));

vi.mock('@/app/client-portal/request-services/actions', () => ({
  listRequestServiceCatalogGroupsAction: listRequestServiceCatalogGroupsActionMock,
  listMyRecentServiceRequestsAction: listMyRecentServiceRequestsActionMock,
}));

vi.mock('@/app/client-portal/request-services/ServiceRequestCard', () => ({
  ServiceRequestCard: () => <div />,
}));

vi.mock('@/app/client-portal/request-services/my-requests/MyRequestsTable', () => ({
  MyRequestsTable: () => <div />,
}));

describe('server page guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectsMock.mockResolvedValue([]);
    getAllClientsForProjectsMock.mockResolvedValue([]);
    listRequestServiceCatalogGroupsActionMock.mockResolvedValue([]);
    listMyRecentServiceRequestsActionMock.mockResolvedValue([]);
  });

  it('blocks Algadesk projects page before project data actions execute', async () => {
    enforceServerProductRouteMock.mockResolvedValue(boundaryNode);
    const mod = await import('@/app/msp/projects/page');

    const result = await mod.default({ searchParams: Promise.resolve({}) });

    expect(result).toBe(boundaryNode);
    expect(getProjectsMock).not.toHaveBeenCalled();
    expect(getAllClientsForProjectsMock).not.toHaveBeenCalled();
  });

  it('blocks Algadesk request-services page before portal data actions execute', async () => {
    enforceServerProductRouteMock.mockResolvedValue(boundaryNode);
    const mod = await import('@/app/client-portal/request-services/page');

    const result = await mod.default({ searchParams: Promise.resolve({}) });

    expect(result).toBe(boundaryNode);
    expect(listRequestServiceCatalogGroupsActionMock).not.toHaveBeenCalled();
    expect(listMyRecentServiceRequestsActionMock).not.toHaveBeenCalled();
  });
});
