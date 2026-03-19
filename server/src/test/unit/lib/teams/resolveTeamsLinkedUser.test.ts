import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOAuthAccountLinkMock = vi.fn();
const getAdminConnectionMock = vi.fn();

const tables = {
  users: [] as Array<{
    tenant: string;
    user_id: string;
    email: string | null;
    username: string | null;
    user_type: 'internal' | 'client';
  }>,
};

function createAdminDb() {
  return (table: keyof typeof tables) => ({
    select() {
      return this;
    },
    where(criteria: Record<string, unknown>) {
      return {
        first: async () =>
          tables[table].find((row) =>
            Object.entries(criteria).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
          ),
      };
    },
  });
}

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    findOAuthAccountLink: (...args: unknown[]) => findOAuthAccountLinkMock(...args),
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: unknown[]) => getAdminConnectionMock(...args),
}));

const { resolveTeamsLinkedUser } = await import('../../../../../../ee/server/src/lib/teams/resolveTeamsLinkedUser');

describe('resolveTeamsLinkedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.users.length = 0;
    getAdminConnectionMock.mockResolvedValue(createAdminDb());
  });

  it('T197/T267/T269/T357: keeps Teams linked-user resolution under EE while preserving shared auth-backed MSP and tenant matching semantics', async () => {
    findOAuthAccountLinkMock.mockResolvedValue({
      tenant: 'tenant-1',
      user_id: 'user-1',
      provider: 'microsoft',
      provider_account_id: 'microsoft-sub-1',
      provider_email: 'tech@example.com',
    });
    tables.users.push({
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: 'tech@example.com',
      username: 'ttech',
      user_type: 'internal',
    });

    await expect(
      resolveTeamsLinkedUser({
        tenantId: 'tenant-1',
        microsoftAccountId: 'microsoft-sub-1',
      })
    ).resolves.toEqual({
      status: 'linked',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userEmail: 'tech@example.com',
      username: 'ttech',
      providerAccountId: 'microsoft-sub-1',
      matchedBy: 'provider_account_id',
    });
  });

  it('T198/T268/T270/T358: rejects missing, cross-tenant, and client-user Teams identity mappings after the EE move', async () => {
    await expect(
      resolveTeamsLinkedUser({
        tenantId: 'tenant-1',
        microsoftAccountId: '',
      })
    ).resolves.toEqual({
      status: 'not_found',
      tenantId: 'tenant-1',
      message: 'Teams user identity is missing the Microsoft account link required for PSA mapping.',
    });

    findOAuthAccountLinkMock.mockResolvedValueOnce({
      tenant: 'tenant-2',
      user_id: 'user-2',
      provider: 'microsoft',
      provider_account_id: 'microsoft-sub-2',
      provider_email: 'other@example.com',
    });

    await expect(
      resolveTeamsLinkedUser({
        tenantId: 'tenant-1',
        microsoftAccountId: 'microsoft-sub-2',
      })
    ).resolves.toEqual({
      status: 'not_found',
      tenantId: 'tenant-1',
      message: 'No Microsoft account link matches this Teams user for the current tenant.',
    });

    findOAuthAccountLinkMock.mockResolvedValueOnce({
      tenant: 'tenant-1',
      user_id: 'client-user',
      provider: 'microsoft',
      provider_account_id: 'microsoft-sub-3',
      provider_email: 'client@example.com',
    });
    tables.users.push({
      tenant: 'tenant-1',
      user_id: 'client-user',
      email: 'client@example.com',
      username: 'client-user',
      user_type: 'client',
    });

    await expect(
      resolveTeamsLinkedUser({
        tenantId: 'tenant-1',
        microsoftAccountId: 'microsoft-sub-3',
      })
    ).resolves.toEqual({
      status: 'not_found',
      tenantId: 'tenant-1',
      message: 'No MSP user mapping matches this Teams identity for the current tenant.',
    });
  });
});
