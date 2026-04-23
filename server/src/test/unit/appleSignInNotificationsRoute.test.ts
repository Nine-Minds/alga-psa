import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock state ----------------------------------------------------
//
// The route is tested by faking its external collaborators: the JWS verifier
// and the knex connection. We don't build a real signed JWS; we just drive
// the verifier mock to return whatever event we want for each test.

const mockState = vi.hoisted(() => ({
  verifyResult: null as
    | {
        iss: string;
        aud: string;
        iat: number;
        jti: string;
        events: {
          type: string;
          sub: string;
          email?: string;
          is_private_email?: boolean | string;
          event_time: number;
        };
      }
    | null,
  verifyError: null as Error | null,
  rowsByAppleSub: [] as { apple_refresh_token_enc: string | null }[],
  deletedCount: 0,
  updateCalls: [] as { where: Record<string, unknown>; patch: Record<string, unknown> }[],
  revokeCalls: [] as string[],
  dbError: null as Error | null,
}));

vi.mock('@/lib/mobileAuth/appleSignIn', () => ({
  verifyAppleServerNotification: vi.fn(async () => {
    if (mockState.verifyError) throw mockState.verifyError;
    return mockState.verifyResult;
  }),
  revokeAppleRefreshToken: vi.fn(async (token: string) => {
    mockState.revokeCalls.push(token);
  }),
  decryptAppleRefreshToken: vi.fn(async (enc: string) => enc.replace(/^enc:/, '')),
}));

function makeFakeKnex() {
  const builder = {
    _table: '',
    _where: undefined as Record<string, unknown> | undefined,

    where(w: Record<string, unknown>) {
      this._where = w;
      return this;
    },
    select(_columns?: string[]) {
      if (mockState.dbError) return Promise.reject(mockState.dbError);
      if (this._table === 'apple_user_identities') {
        return Promise.resolve(mockState.rowsByAppleSub);
      }
      return Promise.resolve([]);
    },
    async del() {
      if (mockState.dbError) throw mockState.dbError;
      mockState.deletedCount += 1;
      return 1;
    },
    async update(patch: Record<string, unknown>) {
      if (mockState.dbError) throw mockState.dbError;
      mockState.updateCalls.push({
        where: this._where ?? {},
        patch,
      });
      return 1;
    },
  };

  function client(table: string) {
    const inst = Object.create(builder);
    inst._table = table;
    inst._where = undefined;
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

function makeRequest(body?: unknown) {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/api/v1/mobile/auth/apple/notifications', init);
}

function notification(overrides: Partial<{
  type: string;
  sub: string;
  email: string;
  is_private_email: boolean | string;
  event_time: number;
}> = {}) {
  return {
    iss: 'https://appleid.apple.com',
    aud: 'com.nineminds.algapsa',
    iat: Math.floor(Date.now() / 1000),
    jti: 'jti-' + Math.random().toString(36).slice(2),
    events: {
      type: overrides.type ?? 'consent-revoked',
      sub: overrides.sub ?? '001234.user',
      email: overrides.email,
      is_private_email: overrides.is_private_email,
      event_time: overrides.event_time ?? Math.floor(Date.now() / 1000),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  mockState.verifyResult = null;
  mockState.verifyError = null;
  mockState.rowsByAppleSub = [];
  mockState.deletedCount = 0;
  mockState.updateCalls = [];
  mockState.revokeCalls = [];
  mockState.dbError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/v1/mobile/auth/apple/notifications — request validation', () => {
  it('returns 400 on invalid JSON body', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const req = new Request('http://localhost/api/v1/mobile/auth/apple/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json{{',
    });
    const res = await route.POST(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when payload is missing', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when payload is not a string', async () => {
    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: { nested: 'object' } }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 401 when JWS verification fails', async () => {
    mockState.verifyError = new Error('Unknown Apple signing key: abc123');
    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'fake.jws.token' }) as never);
    expect(res.status).toBe(401);
    expect(mockState.deletedCount).toBe(0);
    expect(mockState.updateCalls).toEqual([]);
  });
});

describe('/api/v1/mobile/auth/apple/notifications — consent-revoked / account-delete', () => {
  it('consent-revoked deletes the identity row and revokes the stored refresh token', async () => {
    mockState.verifyResult = notification({ type: 'consent-revoked', sub: '001234.user' });
    mockState.rowsByAppleSub = [{ apple_refresh_token_enc: 'enc:apple-refresh-xyz' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual(['apple-refresh-xyz']);
    expect(mockState.deletedCount).toBe(1);
  });

  it('account-delete uses the same deletion path', async () => {
    mockState.verifyResult = notification({ type: 'account-delete', sub: '001234.user' });
    mockState.rowsByAppleSub = [{ apple_refresh_token_enc: 'enc:apple-refresh-xyz' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual(['apple-refresh-xyz']);
    expect(mockState.deletedCount).toBe(1);
  });

  it('acks 200 with no side effects when the Apple sub is unknown to us', async () => {
    mockState.verifyResult = notification({ type: 'consent-revoked', sub: 'unknown.sub' });
    mockState.rowsByAppleSub = [];

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.deletedCount).toBe(0);
  });

  it('still deletes the row even if Apple revoke throws', async () => {
    mockState.verifyResult = notification({ type: 'consent-revoked', sub: '001234.user' });
    mockState.rowsByAppleSub = [{ apple_refresh_token_enc: 'enc:apple-refresh-xyz' }];

    const apple = await import('@/lib/mobileAuth/appleSignIn');
    vi.mocked(apple.revokeAppleRefreshToken).mockRejectedValueOnce(new Error('network down'));

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.deletedCount).toBe(1);
  });

  it('skips revoke when we never stored a refresh token, still deletes the row', async () => {
    mockState.verifyResult = notification({ type: 'consent-revoked', sub: '001234.user' });
    mockState.rowsByAppleSub = [{ apple_refresh_token_enc: null }];

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.revokeCalls).toEqual([]);
    expect(mockState.deletedCount).toBe(1);
  });
});

describe('/api/v1/mobile/auth/apple/notifications — email-disabled / email-enabled', () => {
  it('email-disabled sets email_forwarding_disabled=true for the matching Apple sub', async () => {
    mockState.verifyResult = notification({ type: 'email-disabled', sub: '001234.user' });

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toEqual([
      { where: { apple_user_id: '001234.user' }, patch: { email_forwarding_disabled: true } },
    ]);
    expect(mockState.deletedCount).toBe(0);
    expect(mockState.revokeCalls).toEqual([]);
  });

  it('email-enabled sets email_forwarding_disabled=false for the matching Apple sub', async () => {
    mockState.verifyResult = notification({ type: 'email-enabled', sub: '001234.user' });

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toEqual([
      { where: { apple_user_id: '001234.user' }, patch: { email_forwarding_disabled: false } },
    ]);
  });
});

describe('/api/v1/mobile/auth/apple/notifications — unknown events and errors', () => {
  it('acks 200 on an unknown event type (Apple may add new ones)', async () => {
    mockState.verifyResult = notification({ type: 'some-future-event', sub: '001234.user' });

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(200);
    expect(mockState.deletedCount).toBe(0);
    expect(mockState.updateCalls).toEqual([]);
    expect(mockState.revokeCalls).toEqual([]);
  });

  it('returns 500 on a DB error so Apple retries', async () => {
    mockState.verifyResult = notification({ type: 'email-disabled', sub: '001234.user' });
    mockState.dbError = new Error('pool exhausted');

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res = await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(res.status).toBe(500);
  });
});

describe('/api/v1/mobile/auth/apple/notifications — idempotency', () => {
  it('re-delivery of the same consent-revoked event is a no-op after the first one processed', async () => {
    mockState.verifyResult = notification({ type: 'consent-revoked', sub: '001234.user' });
    mockState.rowsByAppleSub = [{ apple_refresh_token_enc: 'enc:apple-refresh-xyz' }];

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    const res1 = await route.POST(makeRequest({ payload: 'jws' }) as never);
    expect(res1.status).toBe(200);
    expect(mockState.deletedCount).toBe(1);

    // Second delivery: nothing left to find, so no revoke / no further delete.
    mockState.rowsByAppleSub = [];
    const res2 = await route.POST(makeRequest({ payload: 'jws' }) as never);
    expect(res2.status).toBe(200);
    expect(mockState.revokeCalls).toEqual(['apple-refresh-xyz']); // unchanged from call 1
    expect(mockState.deletedCount).toBe(1); // unchanged from call 1
  });

  it('re-delivery of email-disabled just re-applies the same patch', async () => {
    mockState.verifyResult = notification({ type: 'email-disabled', sub: '001234.user' });

    const route = await import('@/app/api/v1/mobile/auth/apple/notifications/route');
    await route.POST(makeRequest({ payload: 'jws' }) as never);
    await route.POST(makeRequest({ payload: 'jws' }) as never);

    expect(mockState.updateCalls).toHaveLength(2);
    expect(mockState.updateCalls[0].patch).toEqual({ email_forwarding_disabled: true });
    expect(mockState.updateCalls[1].patch).toEqual({ email_forwarding_disabled: true });
  });
});
