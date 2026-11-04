import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentGeneration: 'generation-old',
  axiosPost: vi.fn(),
  setTenantSecret: vi.fn(),
  getTenantSecret: vi.fn(),
  updateWhere: null as Record<string, unknown> | null,
  providerUpdates: [] as any[],
  nonces: new Map<string, string>(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
    redirect: (url: string | URL) => ({ status: 302, headers: { location: String(url) } }),
  },
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: vi.fn(async () => undefined),
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'NOW' }, raw: vi.fn() }, tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => null,
    getTenantSecret: mocks.getTenantSecret,
    setTenantSecret: mocks.setTenantSecret,
    deleteTenantSecret: vi.fn(),
  }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => ({
      where: (filter: Record<string, unknown>) => ({
        first: async () => name === 'email_providers'
          ? { id: 'provider-1', provider_type: 'imap', inbound_paused_at: null }
          : {
              email_provider_id: 'provider-1',
              host: 'imap.example.test',
              port: 993,
              secure: true,
              allow_starttls: false,
              auth_type: 'oauth2',
              username: 'mailbox@example.test',
              oauth_token_url: 'https://idp.example.test/token',
              oauth_client_id: 'client-id',
              credential_generation: mocks.currentGeneration,
            },
        update: async (values: any) => {
          if (name === 'imap_email_provider_config') mocks.updateWhere = filter;
          else mocks.providerUpdates.push(values);
          return name === 'imap_email_provider_config' &&
            filter.credential_generation !== mocks.currentGeneration ? 0 : 1;
        },
      }),
    }),
  }),
}));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) } }));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://localhost:6379' }) }));
vi.mock('redis', () => ({
  createClient: () => ({
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    set: async (key: string, value: string, options: { NX?: boolean }) => {
      if (options.NX && mocks.nonces.has(key)) return null;
      mocks.nonces.set(key, value);
      return 'OK';
    },
    del: async (key: string) => mocks.nonces.delete(key) ? 1 : 0,
  }),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET } from '@/app/api/email/oauth/imap/callback/route';
import {
  createImapOAuthStateToken,
  storeImapOAuthStateNonce,
} from '@/utils/email/imapOAuthState';

const SIGNING_SECRET = 'imap-oauth-state-test-signing-secret';
const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
process.env.NEXTAUTH_SECRET = SIGNING_SECRET;

afterAll(() => {
  if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
});

async function makeState(credentialGeneration: string | null, ttlSeconds?: number): Promise<string> {
  const { token, payload } = createImapOAuthStateToken({
    tenant: 'tenant-1',
    userId: 'user-1',
    providerId: 'provider-1',
    credentialGeneration,
    redirectUri: 'https://app.example.test/api/email/oauth/imap/callback',
    secret: SIGNING_SECRET,
    ttlSeconds,
  });
  await storeImapOAuthStateNonce(payload.nonce);
  return token;
}

function callbackRequest(state: string) {
  return {
    nextUrl: new URL(`https://app.example.test/api/email/oauth/imap/callback?code=auth-code&state=${encodeURIComponent(state)}`),
  } as any;
}

describe('IMAP OAuth callback credential generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nonces.clear();
    mocks.currentGeneration = 'generation-old';
    mocks.axiosPost.mockResolvedValue({ data: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 } });
    mocks.getTenantSecret.mockResolvedValue('old-client-secret');
    mocks.setTenantSecret.mockResolvedValue(undefined);
    mocks.updateWhere = null;
    mocks.providerUpdates.length = 0;
  });

  it('rejects a client-tampered generation using the real state helpers before exchanging the code', async () => {
    const signedState = await makeState('generation-old');
    const [encodedPayload, signature] = signedState.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8'));
    payload.credentialGeneration = 'generation-new';
    const tamperedState = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

    const response: any = await GET(callbackRequest(tamperedState));
    expect(response.status).toBe(400);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.updateWhere).toBeNull();
  });

  it('refuses an authentic state created for a previous generation before sending credentials', async () => {
    const oldScopeState = await makeState('generation-old');
    mocks.currentGeneration = 'generation-new';

    const response: any = await GET(callbackRequest(oldScopeState));
    expect(response.status).toBe(409);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('rejects expired signed state before exchanging the authorization code', async () => {
    const expiredState = await makeState('generation-old', -1);

    const response: any = await GET(callbackRequest(expiredState));
    expect(response.status).toBe(400);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('reconnects successfully for the current scope and stores refresh credentials in that generation', async () => {
    mocks.currentGeneration = 'generation-new';
    const currentState = await makeState('generation-new');

    const response: any = await GET(callbackRequest(currentState));
    expect(response.status, JSON.stringify(response.body)).toBe(302);
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhere).toMatchObject({ credential_generation: 'generation-new' });
    expect(mocks.setTenantSecret).toHaveBeenCalledWith(
      'tenant-1',
      'imap_refresh_token_provider-1_generation-new',
      'refresh-token'
    );
  });

  it('rejects replay of a successfully consumed reconnect state', async () => {
    const currentState = await makeState('generation-old');

    expect((await GET(callbackRequest(currentState)) as any).status).toBe(302);
    const replay = await GET(callbackRequest(currentState)) as any;
    expect(replay.status).toBe(400);
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(mocks.setTenantSecret).toHaveBeenCalledTimes(1);
  });

  it('does not persist a token response when the generation changes in flight', async () => {
    const currentState = await makeState('generation-old');
    let resolveToken!: (value: any) => void;
    mocks.axiosPost.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    const callback = GET(callbackRequest(currentState));
    await vi.waitFor(() => expect(mocks.axiosPost).toHaveBeenCalledTimes(1));

    mocks.currentGeneration = 'generation-new';
    resolveToken({ data: { access_token: 'stale-access-token', refresh_token: 'stale-refresh-token', expires_in: 3600 } });

    const response: any = await callback;
    expect(response.status).toBe(409);
    expect(mocks.updateWhere).toMatchObject({ credential_generation: 'generation-old' });
    expect(mocks.setTenantSecret).not.toHaveBeenCalled();
    expect(mocks.providerUpdates).toEqual([]);
  });
});
