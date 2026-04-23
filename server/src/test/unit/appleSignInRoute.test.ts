import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock state ----------------------------------------------------
//
// Per-test control over: the verified identity-token payload (or error),
// any previously-linked `apple_user_identities` row, the `users` rows an
// auto-link lookup returns, the authorization-code exchange result, and
// the rate-limiter outcome.

const mockState = vi.hoisted(() => ({
  verifyResult: null as {
    sub: string;
    email?: string;
    email_verified?: boolean | string;
    is_private_email?: boolean | string;
  } | null,
  verifyError: null as Error | null,
  existingByAppleSub: null as
    | {
        apple_user_id: string;
        tenant: string;
        user_id: string;
        email: string | null;
        apple_refresh_token_enc: string | null;
      }
    | null,
  userMatches: [] as { user_id: string; tenant: string }[],
  codeExchangeResult: null as { refresh_token?: string } | null,
  codeExchangeError: null as Error | null,
  insertedRow: null as Record<string, unknown> | null,
  updatedRows: [] as { where: Record<string, unknown>; update: Record<string, unknown> }[],
  rateLimitError: null as Error | null,
  issuedOttArgs: null as {
    tenantId: string;
    userId: string;
    state: string;
    metadata?: Record<string, unknown>;
  } | null,
}));

vi.mock('@/lib/mobileAuth/appleSignIn', () => ({
  getAppleSignInConfig: vi.fn(async () => ({ bundleId: 'com.nineminds.algapsa' })),
  verifyAppleIdentityToken: vi.fn(async () => {
    if (mockState.verifyError) throw mockState.verifyError;
    return mockState.verifyResult;
  }),
  exchangeAppleAuthorizationCode: vi.fn(async () => {
    if (mockState.codeExchangeError) throw mockState.codeExchangeError;
    return mockState.codeExchangeResult;
  }),
  encryptAppleRefreshToken: vi.fn(async (plain: string) => `enc:${plain}`),
}));

vi.mock('@/lib/mobileAuth/mobileAuthService', () => ({
  issueMobileOtt: vi.fn(async (args: {
    tenantId: string;
    userId: string;
    state: string;
    metadata?: Record<string, unknown>;
  }) => {
    mockState.issuedOttArgs = args;
    return { ott: 'ott-123', expiresAtMs: Date.now() + 120_000 };
  }),
}));

vi.mock('@/lib/security/mobileAuthRateLimiting', () => ({
  enforceMobileOttIssueLimit: vi.fn(async () => {
    if (mockState.rateLimitError) throw mockState.rateLimitError;
  }),
}));

// Minimal knex-like builder. The route uses: where / whereRaw / first / select /
// insert / onConflict / merge / update, plus knex.fn.now(). We only implement
// what the route actually calls.
function makeFakeKnex() {
  const builder = {
    _table: '',
    _where: [] as Record<string, unknown>[],
    _whereRaw: null as { sql: string; bindings: unknown[] } | null,
    _insertRow: undefined as Record<string, unknown> | undefined,

    where(w: Record<string, unknown>) {
      this._where.push(w);
      return this;
    },
    whereRaw(sql: string, bindings: unknown[]) {
      this._whereRaw = { sql, bindings };
      return this;
    },
    first() {
      if (
        this._table === 'apple_user_identities' &&
        this._where.some((w) => 'apple_user_id' in w)
      ) {
        return Promise.resolve(mockState.existingByAppleSub ?? undefined);
      }
      return Promise.resolve(undefined);
    },
    select(_columns?: string[]) {
      if (this._table === 'users') {
        return Promise.resolve(mockState.userMatches);
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
      mockState.insertedRow = { ...(this._insertRow ?? {}), ...(row ?? {}) };
      return Promise.resolve([]);
    },
    update(patch: Record<string, unknown>) {
      mockState.updatedRows.push({ where: this._where[0] ?? {}, update: patch });
      return Promise.resolve(1);
    },
  };

  function client(table: string) {
    const inst = Object.create(builder);
    inst._table = table;
    inst._where = [];
    inst._whereRaw = null;
    inst._insertRow = undefined;
    return inst;
  }

  (client as unknown as { fn: { now: () => string } }).fn = { now: () => 'NOW()' };
  return client;
}

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => makeFakeKnex()),
  withTransaction: vi.fn(),
  setTenantContext: vi.fn(),
  resetTenantConnectionPool: vi.fn(),
}));

// --- Helpers ---------------------------------------------------------------

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/v1/mobile/auth/apple', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockState.verifyResult = null;
  mockState.verifyError = null;
  mockState.existingByAppleSub = null;
  mockState.userMatches = [];
  mockState.codeExchangeResult = null;
  mockState.codeExchangeError = null;
  mockState.insertedRow = null;
  mockState.updatedRows = [];
  mockState.rateLimitError = null;
  mockState.issuedOttArgs = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/mobile/auth/apple — existing link path', () => {
  it('signs in a user whose Apple sub is already linked and returns an OTT', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: true,
    };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: 'ada@example.com',
      apple_refresh_token_enc: 'enc:existing-refresh',
    };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(
      makeRequest({ identityToken: 'id.tok', state: 'state-123' }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ott).toBe('ott-123');
    expect(body.state).toBe('state-123');
    expect(typeof body.expiresInSec).toBe('number');

    expect(mockState.issuedOttArgs).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      state: 'state-123',
      metadata: { source: 'apple_sign_in' },
    });
    // Existing link path must not insert a new identity row.
    expect(mockState.insertedRow).toBeNull();
  });

  it('updates last_sign_in_at on the matched identity row', async () => {
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: null,
      apple_refresh_token_enc: 'enc:existing',
    };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    const touched = mockState.updatedRows.find((u) => 'last_sign_in_at' in u.update);
    expect(touched).toBeDefined();
    expect(touched?.where).toMatchObject({ apple_user_id: '001234.user' });
  });

  it('upgrades a null stored refresh token when a fresh authorization code is sent', async () => {
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: null,
      apple_refresh_token_enc: null,
    };
    mockState.codeExchangeResult = { refresh_token: 'fresh-refresh' };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    await route.POST(
      makeRequest({
        identityToken: 'id.tok',
        state: 's',
        authorizationCode: 'auth-code',
      }) as never,
    );

    const upgraded = mockState.updatedRows.find(
      (u) => u.update.apple_refresh_token_enc === 'enc:fresh-refresh',
    );
    expect(upgraded).toBeDefined();
  });

  it('does not re-exchange the authorization code when a refresh token is already stored', async () => {
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: null,
      apple_refresh_token_enc: 'enc:already-stored',
    };
    mockState.codeExchangeResult = { refresh_token: 'should-not-be-used' };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    await route.POST(
      makeRequest({
        identityToken: 'id.tok',
        state: 's',
        authorizationCode: 'auth-code',
      }) as never,
    );

    const apple = await import('@/lib/mobileAuth/appleSignIn');
    expect(vi.mocked(apple.exchangeAppleAuthorizationCode)).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/mobile/auth/apple — auto-link by verified email', () => {
  it('links on first sign-in when exactly one internal user matches the verified email', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: true,
      is_private_email: false,
    };
    mockState.userMatches = [{ user_id: 'user-1', tenant: 'tenant-1' }];
    mockState.codeExchangeResult = { refresh_token: 'apple-refresh-xyz' };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(
      makeRequest({
        identityToken: 'id.tok',
        state: 's',
        authorizationCode: 'auth-code-1',
      }) as never,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).ott).toBe('ott-123');

    expect(mockState.insertedRow).toMatchObject({
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: 'ada@example.com',
      is_private_email: false,
      apple_refresh_token_enc: 'enc:apple-refresh-xyz',
    });
  });

  it('returns 404 no_account when no user matches the verified email', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: true,
    };
    mockState.userMatches = [];

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('no_account');
    expect(mockState.insertedRow).toBeNull();
    expect(mockState.issuedOttArgs).toBeNull();
  });

  it('returns 404 when multiple users share the email (no silent guess)', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'shared@example.com',
      email_verified: true,
    };
    mockState.userMatches = [
      { user_id: 'user-1', tenant: 'tenant-1' },
      { user_id: 'user-2', tenant: 'tenant-2' },
    ];

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(404);
    expect(mockState.insertedRow).toBeNull();
    expect(mockState.issuedOttArgs).toBeNull();
  });

  it('refuses to auto-link when the token says email_verified=false, even if a user exists', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: false,
    };
    // A row exists but we must not consult the users table for unverified emails.
    mockState.userMatches = [{ user_id: 'user-1', tenant: 'tenant-1' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(404);
    expect(mockState.insertedRow).toBeNull();
  });

  it('accepts the string "true" for email_verified (Apple sometimes sends strings)', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: 'true',
    };
    mockState.userMatches = [{ user_id: 'user-1', tenant: 'tenant-1' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.insertedRow).toMatchObject({
      apple_user_id: '001234.user',
      user_id: 'user-1',
    });
  });

  it('proceeds without a refresh token when auth-code exchange fails (non-fatal per guideline 5.1.1(v) best-effort revoke)', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@example.com',
      email_verified: true,
    };
    mockState.userMatches = [{ user_id: 'user-1', tenant: 'tenant-1' }];
    mockState.codeExchangeError = new Error('Apple token exchange failed: 500 oops');

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(
      makeRequest({
        identityToken: 'id.tok',
        state: 's',
        authorizationCode: 'auth-code-1',
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(mockState.insertedRow).toMatchObject({
      apple_user_id: '001234.user',
      apple_refresh_token_enc: null,
    });
  });

  it('normalizes is_private_email="true" as a boolean when persisting and in OTT metadata', async () => {
    mockState.verifyResult = {
      sub: '001234.user',
      email: 'ada@privaterelay.appleid.com',
      email_verified: true,
      is_private_email: 'true',
    };
    mockState.userMatches = [{ user_id: 'user-1', tenant: 'tenant-1' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(mockState.insertedRow).toMatchObject({ is_private_email: true });
    expect(mockState.issuedOttArgs?.metadata).toMatchObject({ isPrivateEmail: true });
  });
});

describe('POST /api/v1/mobile/auth/apple — token verification and input validation', () => {
  it('returns 401 (not 500) when identity-token verification fails', async () => {
    mockState.verifyError = new Error('jwt expired');

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(401);
    expect(mockState.insertedRow).toBeNull();
    expect(mockState.issuedOttArgs).toBeNull();
  });

  it('returns 401 when the verified payload has an empty sub', async () => {
    mockState.verifyResult = { sub: '' };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(401);
  });

  it('returns a 4xx when identityToken is missing from the body', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ state: 's' }) as never);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('returns a 4xx when state is missing from the body', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok' }) as never);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('POST /api/v1/mobile/auth/apple — rate limiting', () => {
  it('enforces the OTT-issue rate limit with a tenant:user:ip key', async () => {
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: null,
      apple_refresh_token_enc: null,
    };

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    await route.POST(
      makeRequest(
        { identityToken: 'id.tok', state: 's' },
        { 'x-forwarded-for': '203.0.113.10' },
      ) as never,
    );

    const rl = await import('@/lib/security/mobileAuthRateLimiting');
    expect(vi.mocked(rl.enforceMobileOttIssueLimit)).toHaveBeenCalledWith(
      'tenant-1:user-1:203.0.113.10',
    );
  });

  it('returns 429 and does not issue an OTT when the rate limiter rejects the request', async () => {
    const { TooManyRequestsError } = await import('@/lib/api/middleware/apiMiddleware');
    mockState.verifyResult = { sub: '001234.user' };
    mockState.existingByAppleSub = {
      apple_user_id: '001234.user',
      tenant: 'tenant-1',
      user_id: 'user-1',
      email: null,
      apple_refresh_token_enc: null,
    };
    mockState.rateLimitError = new TooManyRequestsError('slow down');

    const route = await import('@/app/api/v1/mobile/auth/apple/route');
    const res = await route.POST(makeRequest({ identityToken: 'id.tok', state: 's' }) as never);

    expect(res.status).toBe(429);
    expect(mockState.issuedOttArgs).toBeNull();
  });
});
