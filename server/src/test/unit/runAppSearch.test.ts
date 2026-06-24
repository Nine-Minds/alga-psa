import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_OBJECT_TYPES } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  resolveSearchAclPrincipal: vi.fn(),
  verifyResultVisibility: vi.fn(),
  runSearchQuery: vi.fn(),
  countSearchMatchesByType: vi.fn(),
  encodeSearchCursor: vi.fn(),
  registeredObjectTypes: vi.fn(),
}));

vi.mock('@alga-psa/search/acl', () => ({
  resolveSearchAclPrincipal: mocks.resolveSearchAclPrincipal,
  verifyResultVisibility: mocks.verifyResultVisibility,
}));

vi.mock('@alga-psa/search/query', () => ({
  runSearchQuery: mocks.runSearchQuery,
  countSearchMatchesByType: mocks.countSearchMatchesByType,
  encodeSearchCursor: mocks.encodeSearchCursor,
}));

vi.mock('@alga-psa/search/index', () => ({
  registeredObjectTypes: mocks.registeredObjectTypes,
}));

import { runAppSearch } from '@alga-psa/search/runAppSearch';

const knex = { fake: 'knex' } as any;

const internalUser = {
  user_id: 'user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
} as any;

const clientUser = {
  user_id: 'user-2',
  tenant: 'tenant-1',
  user_type: 'client',
  clientId: 'client-1',
} as any;

function hit(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ticket',
    id: 'ticket-1',
    title: 'Laptop will not boot',
    url: '/msp/tickets/ticket-1',
    score: 1,
    updatedAt: new Date('2026-05-13T12:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

describe('runAppSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registeredObjectTypes.mockReturnValue([...SEARCH_OBJECT_TYPES]);
    mocks.countSearchMatchesByType.mockResolvedValue({ ticket: 1 });
    mocks.encodeSearchCursor.mockReturnValue('cursor-token');
  });

  it('scopes client-portal users to their own client', async () => {
    const acl = { userId: 'user-2', tenant: 'tenant-1', permissions: ['ticket:read'] };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([hit()]);
    mocks.verifyResultVisibility.mockResolvedValue([hit()]);

    await runAppSearch(knex, 'tenant-1', clientUser, { query: 'laptop' });

    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(
      knex,
      clientUser,
      { mode: 'scoped', clientIds: ['client-1'] },
    );
  });

  it('leaves internal users unrestricted', async () => {
    const acl = { userId: 'user-1', tenant: 'tenant-1', permissions: ['ticket:read'] };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    await runAppSearch(knex, 'tenant-1', internalUser, { query: 'laptop' });

    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(
      knex,
      internalUser,
      { mode: 'all' },
    );
  });

  it('queries only the types the user has permission for', async () => {
    const acl = { userId: 'user-1', tenant: 'tenant-1', permissions: ['ticket:read'] };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    await runAppSearch(knex, 'tenant-1', internalUser, { query: 'laptop' });

    const { allowedTypes } = mocks.runSearchQuery.mock.calls[0][0];
    // ticket:read maps to ticket-family types, never to client/invoice/etc.
    expect(allowedTypes).toContain('ticket');
    expect(allowedTypes).not.toContain('client');
    expect(allowedTypes).not.toContain('invoice');
  });

  it('honours an explicit type filter intersected with permissions', async () => {
    const acl = {
      userId: 'user-1',
      tenant: 'tenant-1',
      permissions: ['ticket:read', 'invoice:read'],
    };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    await runAppSearch(knex, 'tenant-1', internalUser, {
      query: 'laptop',
      types: ['ticket', 'invoice'],
    });

    const { allowedTypes } = mocks.runSearchQuery.mock.calls[0][0];
    expect([...allowedTypes].sort()).toEqual(['invoice', 'ticket']);
  });

  it('returns a nextCursor only when there are more results than the page', async () => {
    const acl = { userId: 'user-1', tenant: 'tenant-1', permissions: ['ticket:read'] };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    // limit 1 -> runSearchQuery is asked for limit + 1 = 2; returning 2 signals "more".
    const hits = [hit({ id: 'ticket-1' }), hit({ id: 'ticket-2' })];
    mocks.runSearchQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    const result = await runAppSearch(knex, 'tenant-1', internalUser, {
      query: 'laptop',
      limit: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ticket-1');
    expect(result.nextCursor).toBe('cursor-token');
    expect(result.totalCount).toBe(1);
    expect(result.groups.ticket).toBe(1);
  });

  it('omits nextCursor when the result set fits the page', async () => {
    const acl = { userId: 'user-1', tenant: 'tenant-1', permissions: ['ticket:read'] };
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([hit()]);
    mocks.verifyResultVisibility.mockResolvedValue([hit()]);

    const result = await runAppSearch(knex, 'tenant-1', internalUser, {
      query: 'laptop',
      limit: 10,
    });

    expect(result.nextCursor).toBeUndefined();
  });
});
