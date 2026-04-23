import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock state ----------------------------------------------------
//
// Per-test control over: api-key auth result, tenant row, other-internal-user
// count, Apple identity rows the deletion loop sees, and whether/how the
// Apple revoke call behaves. We also capture the tenant-deletion-workflow
// input so tests can assert whether it was triggered.

const mockState = vi.hoisted(() => ({
  validateResult: null as { tenant: string; user_id: string } | null,
  tenantRow: null as
    | { tenant: string; billing_source: string | null; plan: string | null }
    | null,
  otherInternalUserCount: 0,
  appleIdentities: [] as {
    apple_user_id: string;
    apple_refresh_token_enc: string | null;
  }[],
  userUpdates: [] as { where: Record<string, unknown>; update: Record<string, unknown> }[],
  apiKeyUpdates: [] as { where: Record<string, unknown>; update: Record<string, unknown> }[],
  appleIdentityDeletes: [] as Record<string, unknown>[],
  revokeCalls: [] as string[],
  revokeShouldThrow: false,
  workflowCalls: [] as Array<{
    tenantId: string;
    triggerSource: string;
    triggeredBy: string;
    reason: string;
  }>,
  workflowResult: { available: true, workflowId: 'wf-abc' } as {
    available: boolean;
    workflowId?: string | null;
  },
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => mockState.validateResult),
    validateApiKeyForTenant: vi.fn(async () => mockState.validateResult),
  },
}));

vi.mock('@/lib/mobileAuth/appleSignIn', () => ({
  decryptAppleRefreshToken: vi.fn(async (enc: string) => enc.replace(/^enc:/, '')),
  revokeAppleRefreshToken: vi.fn(async (token: string) => {
    if (mockState.revokeShouldThrow) {
      throw new Error('apple revoke network error');
    }
    mockState.revokeCalls.push(token);
  }),
}));

vi.mock('@ee/lib/tenant-management/workflowClient', () => ({
  startTenantDeletionWorkflow: vi.fn(async (args: {
    tenantId: string;
    triggerSource: string;
    triggeredBy: string;
    reason: string;
  }) => {
    mockState.workflowCalls.push(args);
    return mockState.workflowResult;
  }),
}));

// Minimal knex-like builder. Shared by the top-level `knex` and the `trx`
// passed into knex.transaction(...). Only implements the surface the route
// actually calls.
function makeFakeKnex() {
  const builder = {
    _table: '',
    _where: [] as Record<string, unknown>[],
    _whereNot: [] as Record<string, unknown>[],

    where(w: Record<string, unknown>) {
      this._where.push(w);
      return this;
    },
    whereNot(w: Record<string, unknown>) {
      this._whereNot.push(w);
      return this;
    },
    first() {
      if (this._table === 'tenants') {
        return Promise.resolve(mockState.tenantRow ?? undefined);
      }
      return Promise.resolve(undefined);
    },
    count(_col: string) {
      if (this._table === 'users') {
        return Promise.resolve([{ count: String(mockState.otherInternalUserCount) }]);
      }
      return Promise.resolve([{ count: '0' }]);
    },
    select(_cols?: string[]) {
      if (this._table === 'apple_user_identities') {
        return Promise.resolve(mockState.appleIdentities);
      }
      return Promise.resolve([]);
    },
    update(patch: Record<string, unknown>) {
      const whereClause = this._where[0] ?? {};
      if (this._table === 'users') {
        mockState.userUpdates.push({ where: whereClause, update: patch });
      } else if (this._table === 'api_keys') {
        mockState.apiKeyUpdates.push({ where: whereClause, update: patch });
      }
      return Promise.resolve(1);
    },
    del() {
      if (this._table === 'apple_user_identities') {
        mockState.appleIdentityDeletes.push(this._where[0] ?? {});
      }
      return Promise.resolve(1);
    },
  };

  function client(table: string) {
    const inst = Object.create(builder);
    inst._table = table;
    inst._where = [];
    inst._whereNot = [];
    return inst;
  }

  (client as unknown as {
    transaction: (cb: (trx: unknown) => Promise<unknown>) => Promise<unknown>;
  }).transaction = async (cb) => {
    // The route doesn't rely on real atomicity — just pass a trx that speaks
    // the same surface as knex itself.
    const trx = makeFakeKnex();
    return cb(trx);
  };

  return client;
}

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => makeFakeKnex()),
}));

// --- Helpers ---------------------------------------------------------------

function makeRequest(headers: Record<string, string> = { authorization: 'Bearer fake-token' }) {
  return new Request('http://localhost/api/v1/mobile/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockState.validateResult = { tenant: 'tenant-1', user_id: 'user-1' };
  mockState.tenantRow = {
    tenant: 'tenant-1',
    billing_source: 'apple_iap',
    plan: 'solo_monthly',
  };
  mockState.otherInternalUserCount = 0;
  mockState.appleIdentities = [];
  mockState.userUpdates = [];
  mockState.apiKeyUpdates = [];
  mockState.appleIdentityDeletes = [];
  mockState.revokeCalls = [];
  mockState.revokeShouldThrow = false;
  mockState.workflowCalls = [];
  mockState.workflowResult = { available: true, workflowId: 'wf-abc' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/mobile/account/delete — authentication', () => {
  it('returns 401 when no Authorization or x-api-key header is present', async () => {
    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const req = new Request('http://localhost/api/v1/mobile/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = await route.POST(req as never);

    expect(res.status).toBe(401);
    expect(mockState.userUpdates).toEqual([]);
    expect(mockState.revokeCalls).toEqual([]);
  });

  it('returns 401 when the api-key lookup returns null', async () => {
    mockState.validateResult = null;

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(401);
    expect(mockState.userUpdates).toEqual([]);
    expect(mockState.revokeCalls).toEqual([]);
  });
});

describe('POST /api/v1/mobile/account/delete — soft-delete and Apple revoke', () => {
  it('soft-deletes the caller and deactivates their api keys when the tenant has other internal users', async () => {
    mockState.otherInternalUserCount = 2;

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: true, tenantDeleted: false });

    expect(mockState.userUpdates).toEqual([
      {
        where: { user_id: 'user-1', tenant: 'tenant-1' },
        update: { is_inactive: true },
      },
    ]);
    expect(mockState.apiKeyUpdates).toEqual([
      {
        where: { user_id: 'user-1', tenant: 'tenant-1' },
        update: { active: false },
      },
    ]);
    // No Apple rows → no revoke and no identity delete.
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.appleIdentityDeletes).toEqual([]);
    // Other users on tenant → no workflow even on apple_iap.
    expect(mockState.workflowCalls).toEqual([]);
  });

  it('revokes the decrypted Apple refresh token and deletes the identity row (5.1.1(v))', async () => {
    mockState.otherInternalUserCount = 2;
    mockState.appleIdentities = [
      { apple_user_id: '001234.user', apple_refresh_token_enc: 'enc:apple-refresh-xyz' },
    ];

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual(['apple-refresh-xyz']);
    expect(mockState.appleIdentityDeletes).toEqual([
      { tenant: 'tenant-1', user_id: 'user-1' },
    ]);
  });

  it('skips revoke when the identity row has no stored refresh token, but still deletes the row', async () => {
    mockState.otherInternalUserCount = 2;
    mockState.appleIdentities = [
      { apple_user_id: '001234.user', apple_refresh_token_enc: null },
    ];

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.appleIdentityDeletes).toEqual([
      { tenant: 'tenant-1', user_id: 'user-1' },
    ]);
  });

  it('still completes account deletion when the Apple revoke call fails (best-effort)', async () => {
    mockState.otherInternalUserCount = 2;
    mockState.appleIdentities = [
      { apple_user_id: '001234.user', apple_refresh_token_enc: 'enc:apple-refresh-xyz' },
    ];
    mockState.revokeShouldThrow = true;

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    // User deactivation and identity deletion still happened.
    expect(mockState.userUpdates).toHaveLength(1);
    expect(mockState.appleIdentityDeletes).toEqual([
      { tenant: 'tenant-1', user_id: 'user-1' },
    ]);
  });

  it('revokes and deletes every Apple identity row attached to the user', async () => {
    mockState.otherInternalUserCount = 2;
    mockState.appleIdentities = [
      { apple_user_id: '001234.user.a', apple_refresh_token_enc: 'enc:refresh-a' },
      { apple_user_id: '001234.user.b', apple_refresh_token_enc: 'enc:refresh-b' },
    ];

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    await route.POST(makeRequest() as never);

    expect(mockState.revokeCalls.sort()).toEqual(['refresh-a', 'refresh-b']);
    // Single DELETE scoped by user/tenant covers both rows.
    expect(mockState.appleIdentityDeletes).toEqual([
      { tenant: 'tenant-1', user_id: 'user-1' },
    ]);
  });
});

describe('POST /api/v1/mobile/account/delete — tenant lifecycle', () => {
  it('starts the tenant-deletion workflow when the caller was the last internal user on an apple_iap tenant', async () => {
    mockState.otherInternalUserCount = 0;
    mockState.tenantRow = { tenant: 'tenant-1', billing_source: 'apple_iap', plan: 'solo_monthly' };

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      deleted: true,
      tenantDeleted: true,
      tenantDeletionWorkflowId: 'wf-abc',
    });
    expect(mockState.workflowCalls).toEqual([
      {
        tenantId: 'tenant-1',
        triggerSource: 'manual',
        triggeredBy: 'user-1',
        reason: 'apple_iap_account_deletion',
      },
    ]);
  });

  it('does not start the workflow when the caller is not the last internal user', async () => {
    mockState.otherInternalUserCount = 1;
    mockState.tenantRow = { tenant: 'tenant-1', billing_source: 'apple_iap', plan: 'solo_monthly' };

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(mockState.workflowCalls).toEqual([]);
    expect((await res.json()).tenantDeleted).toBe(false);
  });

  it('does not start the workflow when the tenant is Stripe-billed, even if last user', async () => {
    mockState.otherInternalUserCount = 0;
    mockState.tenantRow = { tenant: 'tenant-1', billing_source: 'stripe', plan: 'pro' };

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(mockState.workflowCalls).toEqual([]);
    expect((await res.json()).tenantDeleted).toBe(false);
  });

  it('records tenantDeleted=false when the workflow client reports it is unavailable', async () => {
    mockState.otherInternalUserCount = 0;
    mockState.workflowResult = { available: false };

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantDeleted).toBe(false);
    expect(body.tenantDeletionWorkflowId).toBeNull();
  });

  it('returns ok:true deleted:false when the tenant row cannot be found', async () => {
    mockState.tenantRow = null;

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: false });
    // No deactivation, no revoke, no workflow.
    expect(mockState.userUpdates).toEqual([]);
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.workflowCalls).toEqual([]);
  });
});

describe('POST /api/v1/mobile/account/delete — response contents', () => {
  it('always returns Apple-subscription cancellation instructions for the mobile client to show', async () => {
    mockState.otherInternalUserCount = 2;

    const route = await import('@/app/api/v1/mobile/account/delete/route');
    const res = await route.POST(makeRequest() as never);

    const body = await res.json();
    expect(typeof body.subscriptionCancellationInstructions).toBe('string');
    expect(body.subscriptionCancellationInstructions).toMatch(/Subscriptions/i);
  });
});
