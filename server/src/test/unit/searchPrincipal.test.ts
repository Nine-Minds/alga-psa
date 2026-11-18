import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveSearchPrincipal is the principal every app_search_index reader outside runAppSearch uses
// (smart search, the chat search tool). It must carry the subject's client and board restriction,
// never fall back to an unrestricted principal for a narrowed internal user.

const mocks = vi.hoisted(() => ({
  resolveSearchAclPrincipal: vi.fn(),
  resolveReadableScope: vi.fn(),
}));

vi.mock('@alga-psa/search/acl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/search/acl')>()),
  resolveSearchAclPrincipal: mocks.resolveSearchAclPrincipal,
}));

vi.mock('@alga-psa/authorization/subject', () => ({
  resolveReadableScope: mocks.resolveReadableScope,
}));

vi.mock('@alga-psa/search/index', () => ({ registeredObjectTypes: () => [] }));

import { resolveSearchPrincipal } from '@alga-psa/search/runAppSearch';

const knex = { fake: 'knex' } as any;
const internalUser = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' } as any;
const clientUser = { user_id: 'user-2', tenant: 'tenant-1', user_type: 'client', clientId: 'client-1' } as any;

describe('resolveSearchPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSearchAclPrincipal.mockImplementation(async (_knex, user, clientAccess) => ({
      userId: user.user_id,
      clientAccess,
    }));
  });

  it('narrows a client-restricted internal user by resource, with their boards', async () => {
    mocks.resolveReadableScope.mockResolvedValue({
      clientIdsByResource: { ticket: ['client-a'], project: null, client: ['client-a', 'client-b'] },
      boardIds: ['board-1'],
    });

    const principal = await resolveSearchPrincipal(knex, 'tenant-1', internalUser);

    expect(mocks.resolveReadableScope).toHaveBeenCalledWith(knex, expect.objectContaining({ tenant: 'tenant-1', user: internalUser }));
    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(knex, internalUser, {
      mode: 'by_resource',
      clientIdsByResource: { ticket: ['client-a'], client: ['client-a', 'client-b'] },
      boardIds: ['board-1'],
    });
    expect(principal.clientAccess.mode).toBe('by_resource');
  });

  it('leaves an unrestricted internal user in the all mode', async () => {
    mocks.resolveReadableScope.mockResolvedValue({ clientIdsByResource: { ticket: null }, boardIds: null });

    await resolveSearchPrincipal(knex, 'tenant-1', internalUser);

    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(knex, internalUser, { mode: 'all' });
  });

  it('scopes a client-portal user to their own client without loading rules', async () => {
    await resolveSearchPrincipal(knex, 'tenant-1', clientUser);

    expect(mocks.resolveReadableScope).not.toHaveBeenCalled();
    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(knex, clientUser, { mode: 'scoped', clientIds: ['client-1'] });
  });
});
