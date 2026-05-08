import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  storedRow: null as Record<string, unknown> | null,
  getConnectionMock: vi.fn(async () => {
    function knex(table: string) {
      if (table !== 'webhooks') {
        throw new Error(`Unhandled table: ${table}`);
      }
      const chain: any = {
        where: () => chain,
        first: async () => dbState.storedRow,
      };
      return chain;
    }
    (knex as any).fn = { now: () => 'NOW()' };
    return knex;
  }),
}));

const secretsState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  setTenantSecretMock: vi.fn(),
  getTenantSecretMock: vi.fn(),
  deleteTenantSecretMock: vi.fn(),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: (...args: unknown[]) => dbState.getConnectionMock(...args),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    setTenantSecret: (...args: unknown[]) => secretsState.setTenantSecretMock(...args),
    getTenantSecret: (...args: unknown[]) => secretsState.getTenantSecretMock(...args),
    deleteTenantSecret: (...args: unknown[]) => secretsState.deleteTenantSecretMock(...args),
  }),
}));

import { webhookModel, buildWebhookSigningSecretName, buildWebhookSigningSecretVaultPath } from '@/lib/webhooks/webhookModel';
import { signRequest, verifyWebhookSignature } from '@/lib/webhooks/sign';

const TENANT = 'tenant-a';
const WEBHOOK_ID = '11111111-1111-1111-1111-111111111111';
const SECRET_NAME = buildWebhookSigningSecretName(WEBHOOK_ID);
const VAULT_PATH = buildWebhookSigningSecretVaultPath(TENANT, SECRET_NAME);

function seedWebhookRow() {
  dbState.storedRow = {
    tenant: TENANT,
    webhook_id: WEBHOOK_ID,
    name: 'My webhook',
    url: 'https://example.com/hook',
    method: 'POST',
    event_types: ['ticket.assigned'],
    custom_headers: null,
    event_filter: null,
    signing_secret_vault_path: VAULT_PATH,
    security_type: 'hmac',
    verify_ssl: true,
    retry_config: null,
    rate_limit_per_min: 100,
    is_active: true,
    total_deliveries: 0,
    successful_deliveries: 0,
    failed_deliveries: 0,
    last_delivery_at: null,
    last_success_at: null,
    last_failure_at: null,
    auto_disabled_at: null,
    created_by_user_id: 'user-1',
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('webhook secret lifecycle (T032)', () => {
  beforeEach(() => {
    secretsState.store.clear();
    secretsState.setTenantSecretMock.mockReset();
    secretsState.getTenantSecretMock.mockReset();
    secretsState.deleteTenantSecretMock.mockReset();

    secretsState.setTenantSecretMock.mockImplementation(
      async (tenant: string, name: string, value: string) => {
        secretsState.store.set(`${tenant}/${name}`, value);
      },
    );
    secretsState.getTenantSecretMock.mockImplementation(
      async (tenant: string, name: string) => secretsState.store.get(`${tenant}/${name}`),
    );
    secretsState.deleteTenantSecretMock.mockImplementation(
      async (tenant: string, name: string) => {
        secretsState.store.delete(`${tenant}/${name}`);
      },
    );

    dbState.getConnectionMock.mockClear();
    seedWebhookRow();
  });

  afterEach(() => {
    dbState.storedRow = null;
  });

  it('getById strips signing_secret_vault_path and returns no /signing_secret/i field', async () => {
    const webhook = await webhookModel.getById(WEBHOOK_ID, TENANT);
    expect(webhook).not.toBeNull();

    const json = JSON.stringify(webhook);
    expect(/signing[_-]?secret/i.test(json)).toBe(false);
    expect(Object.keys(webhook!).some((k) => /signing[_-]?secret/i.test(k))).toBe(false);
  });

  it('getSigningSecret returns the plaintext secret stored via the provider', async () => {
    const ORIGINAL = 'original-secret';
    secretsState.store.set(`${TENANT}/${SECRET_NAME}`, ORIGINAL);

    const resolved = await webhookModel.getSigningSecret(WEBHOOK_ID, TENANT);
    expect(resolved).toBe(ORIGINAL);
    expect(secretsState.getTenantSecretMock).toHaveBeenCalledWith(TENANT, SECRET_NAME);
  });

  it('rotation: a new secret invalidates signatures produced with the old secret', async () => {
    const OLD_SECRET = 'old-secret';
    const NEW_SECRET = 'new-secret-after-rotation';

    secretsState.store.set(`${TENANT}/${SECRET_NAME}`, OLD_SECRET);

    // Rotate by overwriting the stored secret (mirrors what rotateWebhookSecret does
    // server-side: generate plaintext + setTenantSecret + return plaintext once).
    await secretsState.setTenantSecretMock(TENANT, SECRET_NAME, NEW_SECRET);

    const newSecret = await webhookModel.getSigningSecret(WEBHOOK_ID, TENANT);
    expect(newSecret).toBe(NEW_SECRET);

    // A body signed with the NEW secret must not verify with the OLD secret.
    const body = JSON.stringify({ event_id: 'e1', event_type: 'ticket.assigned' });
    const ts = Math.floor(Date.now() / 1000);
    const headerSignedWithNew = signRequest(NEW_SECRET, body, ts);

    expect(verifyWebhookSignature(headerSignedWithNew, body, NEW_SECRET)).toBe(true);
    expect(verifyWebhookSignature(headerSignedWithNew, body, OLD_SECRET)).toBe(false);
  });
});
