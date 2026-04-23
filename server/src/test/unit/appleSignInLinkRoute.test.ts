import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock state ----------------------------------------------------
//
// We control three things per test: the auth lookup, the Apple identity-token
// verification result, and the rows the route sees when it queries
// `apple_user_identities`. Hoisting keeps the factories at module load so
// vi.mock can read them.

const mockState = vi.hoisted(() => ({
  validateResult: null as { tenant: string; user_id: string } | null,
  verifyResult: null as { sub: string; email?: string; is_private_email?: boolean | string } | null,
  verifyError: null as Error | null,
  existingByAppleSub: null as { tenant: string; user_id: string; apple_refresh_token_enc: string | null } | null,
  existingByUser: null as { apple_user_id: string; email: string | null; is_private_email: boolean; apple_refresh_token_enc: string | null } | null,
  rowsByUser: [] as { apple_user_id: string; apple_refresh_token_enc: string | null }[],
  insertedRow: null as Record<string, unknown> | null,
  deletedCount: 0,
  codeExchangeResult: null as { refresh_token?: string } | null,
  revokeCalls: [] as string[],
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => mockState.validateResult),
    validateApiKeyForTenant: vi.fn(async () => mockState.validateResult),
  },
}));

vi.mock('@/lib/mobileAuth/appleSignIn', () => ({
  getAppleSignInConfig: vi.fn(async () => ({ bundleId: 'com.nineminds.algapsa' })),
  verifyAppleIdentityToken: vi.fn(async () => {
    if (mockState.verifyError) throw mockState.verifyError;
    return mockState.verifyResult;
  }),
  exchangeAppleAuthorizationCode: vi.fn(async () => mockState.codeExchangeResult),
  revokeAppleRefreshToken: vi.fn(async (token: string) => {
    mockState.revokeCalls.push(token);
  }),
  decryptAppleRefreshToken: vi.fn(async (enc: string) => enc.replace(/^enc:/, '')),
  encryptAppleRefreshToken: vi.fn(async (plain: string) => `enc:${plain}`),
}));

// Minimal knex-like builder. The route uses a narrow surface of methods; we
// implement only what's called and keep state on `mockState`.
function makeFakeKnex() {
  const builder = {
    _table: '',
    _where: undefined as Record<string, unknown> | undefined,
    _insertRow: undefined as Record<string, unknown> | undefined,
    _mergeRow: undefined as Record<string, unknown> | undefined,

    where(w: Record<string, unknown>) {
      this._where = w;
      return this;
    },
    first(_columns?: string[]) {
      if (this._table === 'apple_user_identities') {
        if (this._where && 'apple_user_id' in this._where) {
          return Promise.resolve(mockState.existingByAppleSub ?? undefined);
        }
        if (
          this._where &&
          'tenant' in this._where &&
          'user_id' in this._where &&
          !('apple_user_id' in this._where)
        ) {
          return Promise.resolve(mockState.existingByUser ?? undefined);
        }
      }
      return Promise.resolve(undefined);
    },
    select(_columns?: string[]) {
      if (this._table === 'apple_user_identities') {
        return Promise.resolve(mockState.rowsByUser);
      }
      return Promise.resolve([]);
    },
    insert(row: Record<string, unknown>) {
      this._insertRow = row;
      return this;
    },
    onConflict(_key: string | string[]) {
      return this;
    },
    merge(row: Record<string, unknown>) {
      this._mergeRow = row;
      mockState.insertedRow = { ...(this._insertRow ?? {}), ...(row ?? {}) };
      return Promise.resolve([]);
    },
    async del() {
      mockState.deletedCount += 1;
      return 1;
    },
  };

  function client(table: string) {
    const inst = Object.create(builder);
    inst._table = table;
    inst._where = undefined;
    inst._insertRow = undefined;
    inst._mergeRow = undefined;
    return inst;
  }

  (client as any).fn = { now: () => 'NOW()' };
  return client;
}

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => makeFakeKnex()),
  withTransaction: vi.fn(),
  setTenantContext: vi.fn(),
  resetTenantConnectionPool: vi.fn(),
}));

// --- Helpers ---------------------------------------------------------------

function makeRequest(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer fake-token', ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request('http://localhost/api/v1/mobile/auth/apple/link', init);
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  mockState.validateResult = { tenant: 'tenant-1', user_id: 'user-1' };
  mockState.verifyResult = null;
  mockState.verifyError = null;
  mockState.existingByAppleSub = null;
  mockState.existingByUser = null;
  mockState.rowsByUser = [];
  mockState.insertedRow = null;
  mockState.deletedCount = 0;
  mockState.codeExchangeResult = null;
  mockState.revokeCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/v1/mobile/auth/apple/link — GET', () => {
  it('reports linked=false when no identity row exists for the caller', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.GET(makeRequest('GET') as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ linked: false });
  });

  it('reports linked=true with email when the caller has a linked Apple ID', async () => {
    mockState.existingByUser = {
      apple_user_id: '001234.user',
      email: 'ada@example.com',
      is_private_email: false,
      apple_refresh_token_enc: null,
    };
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.GET(makeRequest('GET') as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      linked: true,
      email: 'ada@example.com',
      isPrivateEmail: false,
    });
  });

  it('rejects requests without a Bearer token', async () => {
    mockState.validateResult = null;
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const req = new Request('http://localhost/api/v1/mobile/auth/apple/link', { method: 'GET' });
    const res = await route.GET(req as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
  });
});

describe('/api/v1/mobile/auth/apple/link — POST', () => {
  it('links an Apple ID on first connect and exchanges the authorization code for a refresh token', async () => {
    mockState.verifyResult = { sub: '001234.user', email: 'ada@personal.com', is_private_email: false };
    mockState.codeExchangeResult = { refresh_token: 'apple-refresh-xyz' };

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(
      makeRequest('POST', {
        identityToken: 'id.tok',
        authorizationCode: 'auth-code-1',
      }) as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      linked: true,
      email: 'ada@personal.com',
      isPrivateEmail: false,
    });
    expect(mockState.insertedRow).toMatchObject({
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: 'ada@personal.com',
      is_private_email: false,
      apple_refresh_token_enc: 'enc:apple-refresh-xyz',
    });
  });

  it('returns 409 when the Apple ID is already linked to a different user', async () => {
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      tenant: 'other-tenant',
      user_id: 'other-user',
      apple_refresh_token_enc: null,
    };

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(
      makeRequest('POST', { identityToken: 'id.tok' }) as never,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_linked_to_other_user');
    // Did not insert.
    expect(mockState.insertedRow).toBeNull();
  });

  it('is idempotent when the same user re-links the same Apple ID', async () => {
    mockState.verifyResult = { sub: '001234.user', is_private_email: true };
    mockState.existingByAppleSub = {
      tenant: 'tenant-1',
      user_id: 'user-1',
      apple_refresh_token_enc: 'enc:old-refresh',
    };

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(
      makeRequest('POST', { identityToken: 'id.tok' }) as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ linked: true, isPrivateEmail: true });
    // Refresh token preserved (no new authorizationCode was provided).
    expect(mockState.insertedRow?.apple_refresh_token_enc).toBe('enc:old-refresh');
  });

  it('normalizes is_private_email="true" string into a boolean', async () => {
    mockState.verifyResult = { sub: '001234.user', email: 'ada@privaterelay.appleid.com', is_private_email: 'true' };

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(
      makeRequest('POST', { identityToken: 'id.tok' }) as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ isPrivateEmail: true });
  });

  it('rejects a malformed or expired identity token as 401, not 500', async () => {
    mockState.verifyError = new Error('jwt expired');

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(
      makeRequest('POST', { identityToken: 'id.tok' }) as never,
    );

    expect(res.status).toBe(401);
    // Did not insert.
    expect(mockState.insertedRow).toBeNull();
  });

  it('rejects POST without a Bearer token', async () => {
    mockState.validateResult = null;
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const req = new Request('http://localhost/api/v1/mobile/auth/apple/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identityToken: 'id.tok' }),
    });
    const res = await route.POST(req as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
  });

  it('validates body — missing identityToken yields a 4xx', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.POST(makeRequest('POST', {}) as never);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('/api/v1/mobile/auth/apple/link — DELETE', () => {
  it('no-ops (still 200) when the caller has no linked Apple ID', async () => {
    mockState.rowsByUser = [];
    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.DELETE(makeRequest('DELETE') as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ linked: false });
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.deletedCount).toBe(0);
  });

  it('revokes stored Apple refresh tokens and deletes identity rows', async () => {
    mockState.rowsByUser = [
      { apple_user_id: '001234.user', apple_refresh_token_enc: 'enc:apple-refresh-xyz' },
    ];

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.DELETE(makeRequest('DELETE') as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual(['apple-refresh-xyz']);
    expect(mockState.deletedCount).toBe(1);
  });

  it('still deletes the row even if Apple revoke fails', async () => {
    mockState.rowsByUser = [
      { apple_user_id: '001234.user', apple_refresh_token_enc: 'enc:apple-refresh-xyz' },
    ];

    const apple = await import('@/lib/mobileAuth/appleSignIn');
    vi.mocked(apple.revokeAppleRefreshToken).mockRejectedValueOnce(new Error('network down'));

    const route = await import('@/app/api/v1/mobile/auth/apple/link/route');
    const res = await route.DELETE(makeRequest('DELETE') as never);

    expect(res.status).toBe(200);
    expect(mockState.deletedCount).toBe(1);
  });
});
