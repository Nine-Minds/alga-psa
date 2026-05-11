import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdminConnectionMock = vi.fn();

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: () => getAdminConnectionMock(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function buildKnexHarness(conflictingUserId?: string | null) {
  let excludedUserId: string | null = null;
  const rawMock = vi.fn(async () => undefined);
  const insertMock = vi.fn(() => ({
    onConflict: vi.fn(() => ({
      merge: vi.fn(async () => undefined),
    })),
  }));

  const tableMock: any = vi.fn(() => {
    const chain: any = {
      where: vi.fn(() => chain),
      whereNot: vi.fn((_field: string, value: string) => {
        excludedUserId = value;
        return chain;
      }),
      first: vi.fn(async () =>
        conflictingUserId && conflictingUserId !== excludedUserId
          ? { user_id: conflictingUserId }
          : undefined
      ),
      insert: insertMock,
    };
    return chain;
  });
  tableMock.fn = { now: vi.fn(() => 'db-now') };
  tableMock.raw = rawMock;
  tableMock.transaction = vi.fn(async (callback: (trx: any) => Promise<unknown>) => callback(tableMock));
  return { knex: tableMock, insertMock, rawMock };
}

function buildFindHarness(records: Array<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  const tableMock: any = vi.fn(() => {
    const chain: any = {
      where: vi.fn((nextFilters: Record<string, unknown>) => {
        Object.assign(filters, nextFilters);
        return chain;
      }),
      andWhere: vi.fn((nextFilters: Record<string, unknown>) => {
        Object.assign(filters, nextFilters);
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      first: vi.fn(async () =>
        records.find((record) =>
          Object.entries(filters).every(([key, value]) => record[key] === value)
        )
      ),
    };
    return chain;
  });
  return { knex: tableMock };
}

describe('upsertOAuthAccountLink conflict detection', () => {
  beforeEach(() => {
    vi.resetModules();
    getAdminConnectionMock.mockReset();
  });

  it('rejects linking a provider account already linked to a different user before upsert', async () => {
    const harness = buildKnexHarness('different-user');
    getAdminConnectionMock.mockResolvedValue(harness.knex);

    const { upsertOAuthAccountLink, OAuthAccountLinkConflictError } = await import(
      '@ee/lib/auth/oauthAccountLinks'
    );

    await expect(
      upsertOAuthAccountLink({
        tenant: 'tenant-1',
        userId: 'target-user',
        provider: 'microsoft',
        providerAccountId: 'entra-object-1',
      })
    ).rejects.toBeInstanceOf(OAuthAccountLinkConflictError);

    expect(harness.insertMock).not.toHaveBeenCalled();
    expect(harness.rawMock).toHaveBeenCalledWith(
      'select pg_advisory_xact_lock(hashtext(?), hashtext(?))',
      ['oauth_account_link', 'tenant-1:microsoft:entra-object-1']
    );
  });

  it('allows refreshing the link when the provider account is only linked to the same user', async () => {
    const harness = buildKnexHarness('target-user');
    getAdminConnectionMock.mockResolvedValue(harness.knex);

    const { upsertOAuthAccountLink } = await import('@ee/lib/auth/oauthAccountLinks');

    await upsertOAuthAccountLink({
      tenant: 'tenant-1',
      userId: 'target-user',
      provider: 'microsoft',
      providerAccountId: 'entra-object-1',
    });

    expect(harness.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-1',
        user_id: 'target-user',
        provider: 'microsoft',
        provider_account_id: 'entra-object-1',
      })
    );
  });

  it('finds provider account links within the requested tenant', async () => {
    const harness = buildFindHarness([
      {
        tenant: 'tenant-1',
        user_id: 'other-tenant-user',
        provider: 'microsoft',
        provider_account_id: 'entra-object-1',
      },
      {
        tenant: 'tenant-2',
        user_id: 'current-tenant-user',
        provider: 'microsoft',
        provider_account_id: 'entra-object-1',
      },
    ]);
    getAdminConnectionMock.mockResolvedValue(harness.knex);

    const { findOAuthAccountLink } = await import('@ee/lib/auth/oauthAccountLinks');

    await expect(
      findOAuthAccountLink('microsoft', 'entra-object-1', 'tenant-2')
    ).resolves.toEqual(
      expect.objectContaining({
        tenant: 'tenant-2',
        user_id: 'current-tenant-user',
      })
    );
  });
});
