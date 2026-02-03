import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

import {
  __resetMobileAuthTestState,
  __setMobileAuthConnectionFactoryForTests,
  exchangeOttForSession,
  issueMobileOtt,
  refreshMobileSession,
} from 'server/src/lib/mobileAuth/mobileAuthService';
import { ApiKeyService } from 'server/src/lib/services/apiKeyService';
import { auditLog } from 'server/src/lib/logging/auditLog';

vi.mock('server/src/lib/logging/auditLog', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn().mockResolvedValue({
    user_id: 'user-1',
    email: 'user@example.com',
    first_name: 'Test',
    last_name: 'User',
  }),
}));

vi.mock('server/src/lib/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('server/src/lib/db')>();
  return {
    ...mod,
    runWithTenant: async (_tenant: string, fn: () => Promise<any>) => fn(),
  };
});

type MobileOttRow = {
  mobile_auth_ott_id: string;
  tenant: string;
  user_id: string;
  session_id: string | null;
  ott_hash: string;
  state: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  device_id: string | null;
  metadata: any;
};

type MobileRefreshRow = {
  mobile_refresh_token_id: string;
  tenant: string;
  user_id: string;
  api_key_id: string | null;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  last_used_at: Date | null;
  device_id: string | null;
  device: any;
};

type FakeDbState = {
  mobile_auth_otts: MobileOttRow[];
  mobile_refresh_tokens: MobileRefreshRow[];
  sessions: Array<{
    tenant: string;
    session_id: string;
    revoked_at: Date | null;
    expires_at: Date;
  }>;
};

class FakeQueryBuilder<T extends Record<string, any>> {
  private filters: Array<(row: T) => boolean> = [];
  constructor(private readonly table: keyof FakeDbState, private readonly state: FakeDbState, private readonly now: () => Date) {}

  private rows(): T[] {
    const data = this.state[this.table] as unknown as T[];
    if (this.filters.length === 0) return data;
    return data.filter((row) => this.filters.every((f) => f(row)));
  }

  where(criteria: Record<string, any>): this;
  where(column: string, op: string, value: any): this;
  where(a: any, b?: any, c?: any): this {
    if (typeof a === 'object') {
      const criteria = a as Record<string, any>;
      this.filters.push((row) => Object.entries(criteria).every(([k, v]) => (row as any)[k] === v));
      return this;
    }
    const col = a as string;
    const op = b as string;
    const val = c;
    if (op === '>') {
      this.filters.push((row) => (row as any)[col] > val);
      return this;
    }
    this.filters.push((row) => (row as any)[col] === val);
    return this;
  }

  whereNull(column: string): this {
    this.filters.push((row) => (row as any)[column] === null || (row as any)[column] === undefined);
    return this;
  }

  first(): T | undefined {
    return this.rows()[0];
  }

  insert(data: Partial<T>) {
    const row = { ...data } as T;
    if (!(row as any).mobile_auth_ott_id && this.table === 'mobile_auth_otts') {
      (row as any).mobile_auth_ott_id = crypto.randomUUID();
    }
    if (!(row as any).mobile_refresh_token_id && this.table === 'mobile_refresh_tokens') {
      (row as any).mobile_refresh_token_id = crypto.randomUUID();
    }
    (this.state[this.table] as any).push(row);
    return {
      returning: (cols: string[]) => {
        const out: any = {};
        for (const c of cols) out[c] = (row as any)[c];
        return [out];
      },
    };
  }

  update(data: Partial<T>, returning?: string[]) {
    const now = this.now();
    const matches = this.rows();
    for (const row of matches) {
      Object.assign(row, data);
      if ('updated_at' in row) (row as any).updated_at = now;
    }
    if (!returning) return matches.length;
    return matches.map((row) => {
      const out: any = {};
      for (const c of returning) out[c] = (row as any)[c];
      return out;
    });
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createFakeKnex(state: FakeDbState) {
  const fn = { now: () => new Date(Date.now()) };
  const knex: any = (table: keyof FakeDbState) => new FakeQueryBuilder<any>(table, state, fn.now);
  knex.fn = fn;
  return knex;
}

describe('mobile auth (OTT + refresh rotation)', () => {
  const state: FakeDbState = { mobile_auth_otts: [], mobile_refresh_tokens: [], sessions: [] };
  const adminKnex = createFakeKnex(state);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-03T12:00:00.000Z'));
    state.mobile_auth_otts.length = 0;
    state.mobile_refresh_tokens.length = 0;
    state.sessions.length = 0;

    process.env.ALGA_MOBILE_AUTH_ENABLED = 'true';
    process.env.ALGA_MOBILE_OTT_TTL_SEC = '60';
    process.env.ALGA_MOBILE_ACCESS_TTL_SEC = '900';
    process.env.ALGA_MOBILE_REFRESH_TTL_SEC = '3600';

    __setMobileAuthConnectionFactoryForTests(async (tenant: string | null) => {
      return adminKnex;
    });

    state.sessions.push({
      tenant: 'tenant-1',
      session_id: 'session-1',
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });

    vi.spyOn(ApiKeyService, 'createApiKey').mockImplementation(async (_userId, _desc, _expires, opts) => {
      const id = crypto.randomUUID();
      return {
        api_key_id: id,
        api_key: `access-${id}`,
        user_id: 'user-1',
        tenant: opts?.tenantId ?? 'tenant-1',
        description: null,
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        last_used_at: null,
        expires_at: _expires ?? null,
        purpose: 'mobile_session',
        metadata: null,
        usage_limit: null,
        usage_count: 0,
      } as any;
    });

    vi.spyOn(ApiKeyService, 'deactivateApiKey').mockResolvedValue(undefined);

    (auditLog as any).mockClear?.();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetMobileAuthTestState();
    vi.restoreAllMocks();
  });

  it('consumes OTT exactly once', async () => {
    const { ott } = await issueMobileOtt({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      state: 'state-123',
    });

    const first = await exchangeOttForSession({
      ott,
      state: 'state-123',
      device: { deviceId: 'device-1' },
    });

    expect(first.accessToken).toMatch(/^access-/);
    expect(first.refreshToken).toBeTruthy();
    expect(state.mobile_auth_otts[0]?.used_at).not.toBeNull();

    await expect(
      exchangeOttForSession({
        ott,
        state: 'state-123',
        device: { deviceId: 'device-1' },
      }),
    ).rejects.toThrow(/one-time token/i);
  });

  it('rejects expired OTTs', async () => {
    process.env.ALGA_MOBILE_OTT_TTL_SEC = '1';

    const { ott } = await issueMobileOtt({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      state: 'state-abc',
    });

    vi.advanceTimersByTime(2_000);

    await expect(
      exchangeOttForSession({
        ott,
        state: 'state-abc',
        device: { deviceId: 'device-1' },
      }),
    ).rejects.toThrow(/expired one-time token|one-time token/i);
  });

  it('rotates refresh tokens and invalidates prior credentials', async () => {
    const refreshToken = 'refresh-token-1';
    const oldApiKeyId = crypto.randomUUID();

    state.mobile_refresh_tokens.push({
      mobile_refresh_token_id: 'rt-1',
      tenant: 'tenant-1',
      user_id: 'user-1',
      api_key_id: oldApiKeyId,
      token_hash: sha256(refreshToken),
      created_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      replaced_by_id: null,
      last_used_at: null,
      device_id: null,
      device: null,
    });

    const result = await refreshMobileSession({
      refreshToken,
      device: { deviceId: 'device-2' },
    });

    expect(result.accessToken).toMatch(/^access-/);
    expect(result.refreshToken).toBeTruthy();
    expect(state.mobile_refresh_tokens.length).toBe(2);
    expect(state.mobile_refresh_tokens[0]?.revoked_at).not.toBeNull();
    expect(state.mobile_refresh_tokens[0]?.replaced_by_id).toBeTruthy();

    expect(ApiKeyService.deactivateApiKey).toHaveBeenCalledWith(oldApiKeyId, 'tenant-1');

    await expect(refreshMobileSession({ refreshToken })).rejects.toThrow(/refresh token/i);
  });
});
