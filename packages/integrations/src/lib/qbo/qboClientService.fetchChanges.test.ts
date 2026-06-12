import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Secret provider mock (matches the credentials.test.ts harness) ──────────
const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const getAppSecretMock = vi.fn(async (key: string) => appSecrets.get(key) ?? null);
const setTenantSecretMock = vi.fn(async (_tenant: string, _key: string, _value: string) => {});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    getAppSecret: getAppSecretMock,
    setTenantSecret: setTenantSecretMock
  })
}));

// ── axios mock ───────────────────────────────────────────────────────────────
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
      request: vi.fn(),
      isAxiosError: actual.default.isAxiosError
    }
  };
});

import axios from 'axios';
import { QboClientService } from './qboClientService';
import type { QboTenantCredentials } from './types';

const TENANT_ID = 'tenant-fetchchanges-test';
const REALM_ID = 'realm-fc-001';

function setTenantSecret(key: string, value: string) {
  tenantSecrets.set(`${TENANT_ID}:${key}`, value);
}
function setAppSecret(key: string, value: string) {
  appSecrets.set(key, value);
}

/** Create valid (non-expired) QBO credentials for the test realm */
function storeCreds(overrides?: Partial<QboTenantCredentials>) {
  const far = new Date(Date.now() + 3600 * 1000).toISOString();
  const creds: QboTenantCredentials = {
    accessToken: 'at-test',
    refreshToken: 'rt-test',
    realmId: REALM_ID,
    accessTokenExpiresAt: far,
    refreshTokenExpiresAt: new Date(Date.now() + 8640000 * 1000).toISOString(),
    ...overrides
  };
  setTenantSecret('qbo_credentials', JSON.stringify({ [REALM_ID]: creds }));
  setAppSecret('qbo_client_id', 'app-cid');
  setAppSecret('qbo_client_secret', 'app-csec');
  return creds;
}

/** Build a QBO CDC response payload with the given entities in the first QueryResponse */
function buildCdcResponse(entityBuckets: Record<string, any[]>) {
  return {
    CDCResponse: [
      {
        QueryResponse: [entityBuckets]
      }
    ]
  };
}

describe('QboClientService.fetchChanges — CDC parsing', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
    delete process.env.QBO_ENVIRONMENT;
  });

  it('maps entity rows to AccountingExternalChange with correct entityType, externalId, syncToken, deleted=false', async () => {
    storeCreds();

    const cdcPayload = buildCdcResponse({
      Customer: [{ Id: 'c-1', SyncToken: '5', MetaData: { LastUpdatedTime: '2026-01-01T00:00:00Z' }, Active: true }],
      Payment: [{ Id: 'p-1', SyncToken: '3', MetaData: {} }],
      Invoice: [{ Id: 'i-1', SyncToken: '7', MetaData: {} }]
    });

    vi.mocked(axios.request).mockResolvedValueOnce({ data: cdcPayload });

    const client = await QboClientService.create(TENANT_ID, REALM_ID);
    const result = await client.fetchChanges('2026-01-01T00:00:00Z');

    expect(result.truncated).toBe(false);
    expect(result.changes).toHaveLength(3);

    const customer = result.changes.find((c) => c.entityType === 'Customer');
    expect(customer).toBeDefined();
    expect(customer!.externalId).toBe('c-1');
    expect(customer!.syncToken).toBe('5');
    expect(customer!.deleted).toBe(false);

    const payment = result.changes.find((c) => c.entityType === 'Payment');
    expect(payment).toBeDefined();
    expect(payment!.externalId).toBe('p-1');
  });

  it('marks row with status="Deleted" as deleted=true', async () => {
    storeCreds();

    const cdcPayload = buildCdcResponse({
      Invoice: [
        { Id: 'i-active', SyncToken: '2', MetaData: {} },
        { Id: 'i-deleted', SyncToken: '3', MetaData: {}, status: 'Deleted' }
      ]
    });

    vi.mocked(axios.request).mockResolvedValueOnce({ data: cdcPayload });

    const client = await QboClientService.create(TENANT_ID, REALM_ID);
    const result = await client.fetchChanges('2026-01-01T00:00:00Z');

    const deleted = result.changes.find((c) => c.externalId === 'i-deleted');
    expect(deleted).toBeDefined();
    expect(deleted!.deleted).toBe(true);

    const active = result.changes.find((c) => c.externalId === 'i-active');
    expect(active!.deleted).toBe(false);
  });

  it('truncated=true when an entity array has >= 1000 rows', async () => {
    storeCreds();

    const bigArray = Array.from({ length: 1000 }, (_, i) => ({
      Id: `inv-${i}`,
      SyncToken: String(i),
      MetaData: {}
    }));

    const cdcPayload = buildCdcResponse({ Invoice: bigArray });

    vi.mocked(axios.request).mockResolvedValueOnce({ data: cdcPayload });

    const client = await QboClientService.create(TENANT_ID, REALM_ID);
    const result = await client.fetchChanges('2026-01-01T00:00:00Z');

    expect(result.truncated).toBe(true);
    expect(result.changes).toHaveLength(1000);
  });

  it('fetchedAt is an ISO string close to now', async () => {
    storeCreds();

    const cdcPayload = buildCdcResponse({ CreditMemo: [{ Id: 'cm-1', SyncToken: '1', MetaData: {} }] });

    vi.mocked(axios.request).mockResolvedValueOnce({ data: cdcPayload });

    const before = Date.now();
    const client = await QboClientService.create(TENANT_ID, REALM_ID);
    const result = await client.fetchChanges('2026-01-01T00:00:00Z');
    const after = Date.now();

    const fetchedAtMs = new Date(result.fetchedAt).getTime();
    expect(fetchedAtMs).toBeGreaterThanOrEqual(before);
    expect(fetchedAtMs).toBeLessThanOrEqual(after + 100);
  });
});
