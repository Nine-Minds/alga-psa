import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  resolveSearchAclPrincipal: vi.fn(),
  verifyResultVisibility: vi.fn(),
  runSearchQuery: vi.fn(),
  runSearchTypeaheadQuery: vi.fn(),
  encodeSearchCursor: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: unknown) => handler,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('../../lib/search/acl', () => ({
  resolveSearchAclPrincipal: mocks.resolveSearchAclPrincipal,
  verifyResultVisibility: mocks.verifyResultVisibility,
}));

vi.mock('../../lib/search/query', () => ({
  runSearchQuery: mocks.runSearchQuery,
  runSearchTypeaheadQuery: mocks.runSearchTypeaheadQuery,
  encodeSearchCursor: mocks.encodeSearchCursor,
}));

import { searchAppAction } from '../../lib/actions/searchActions';

describe('search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T106 resolves the user permission set exactly once per full search action call', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-1',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      roles: ['technician'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };
    const hits = [{
      type: 'client',
      id: 'client-1',
      title: 'ACME Corp',
      url: '/msp/clients/client-1',
      score: 1,
      updatedAt: new Date('2026-05-13T12:00:00.000Z'),
      metadata: {},
    }];

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    await searchAppAction(
      {
        user_id: 'user-1',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme', limit: 10 },
    );

    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledTimes(1);
    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(knex, expect.any(Object), ['client-1']);
    expect(mocks.runSearchQuery).toHaveBeenCalledWith(expect.objectContaining({ acl }));
    expect(mocks.verifyResultVisibility).toHaveBeenCalledWith(knex, acl, hits);
  });
});
