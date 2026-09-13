import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());
const firstMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));
const selectMock = vi.hoisted(() => vi.fn(() => ({ first: firstMock })));
const tableMock = vi.hoisted(() => vi.fn(() => ({ select: selectMock })));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: tableMock })
}));

import { resolveDefaultXeroConnectionId, XERO_CREDENTIALS_SECRET_NAME } from './xeroClientService';

const CONNECTIONS = {
  'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-1' },
  'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-2' }
};

beforeEach(() => {
  vi.clearAllMocks();
  tableMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ first: firstMock });
  firstMock.mockResolvedValue(undefined);
  getSecretProviderInstanceMock.mockResolvedValue({
    getTenantSecret: vi.fn(async (_tenant: string, name: string) =>
      name === XERO_CREDENTIALS_SECRET_NAME ? JSON.stringify(CONNECTIONS) : null
    )
  });
});

describe('resolveDefaultXeroConnectionId (persisted provider-scoped selection)', () => {
  it('returns the persisted connection id so settings and sync route to the same organisation', async () => {
    firstMock.mockResolvedValue({ settings: { accountingSync: { defaultRealm: 'xero-conn-2' } } });

    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('xero-conn-2');
  });

  it('maps a persisted historical organisation id to its owning connection', async () => {
    firstMock.mockResolvedValue({ settings: { accountingSync: { defaultRealm: 'org-2' } } });

    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('xero-conn-2');
  });

  it('falls back to the first connection when the persisted value is absent or stale', async () => {
    firstMock.mockResolvedValue(undefined);
    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('xero-conn-1');

    firstMock.mockResolvedValue({ settings: { accountingSync: { defaultRealm: 'removed-conn' } } });
    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('xero-conn-1');
  });

  it('does not resolve an ambiguously-owned organisation id', async () => {
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: vi.fn(async (_tenant: string, name: string) =>
        name === XERO_CREDENTIALS_SECRET_NAME
          ? JSON.stringify({
              a: { connectionId: 'a', xeroTenantId: 'org-shared' },
              b: { connectionId: 'b', xeroTenantId: 'org-shared' }
            })
          : null
      )
    });
    firstMock.mockResolvedValue({ settings: { accountingSync: { defaultRealm: 'org-shared' } } });

    // Ambiguous ownership falls back to the first stored connection, never to
    // an arbitrary owner of the shared organisation.
    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('a');
  });

  it('falls back to the first connection when no selection is stored and returns null with none connected', async () => {
    firstMock.mockResolvedValue({ settings: { accountingSync: { defaultRealm: null } } });
    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBe('xero-conn-1');

    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: vi.fn(async () => null)
    });
    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBeNull();
  });
});
