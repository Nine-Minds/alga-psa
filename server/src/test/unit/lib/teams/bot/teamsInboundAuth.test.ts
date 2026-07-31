import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  authenticateTeamsInboundRequest,
  checkTeamsActivityAgainstClaims,
  verifyTeamsInboundActivity,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsInboundAuth';
import { resetTeamsBotJwksCacheForTests } from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotJwtVerifier';

const BOT_APP_ID = 'bot-app-0000';
const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';
const OPENID_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const JWKS_URL = 'https://login.botframework.com/v1/keys.json';
const TRUSTED_SERVICE_URL = 'https://smba.trafficmanager.net/amer';
const KEY_ID = 'teams-inbound-test-key';

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let rogueKey: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksDocument: { keys: Record<string, unknown>[] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface MintTokenOptions {
  issuer?: string;
  audience?: string;
  expired?: boolean;
  key?: CryptoKey | unknown;
  claims?: Record<string, unknown>;
}

async function mintToken(options: MintTokenOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    serviceurl: TRUSTED_SERVICE_URL,
    ...(options.claims || {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(options.issuer ?? BOT_FRAMEWORK_ISSUER)
    .setAudience(options.audience ?? BOT_APP_ID)
    .setIssuedAt(options.expired ? nowSeconds - 7200 : nowSeconds)
    .setExpirationTime(options.expired ? nowSeconds - 3600 : nowSeconds + 3600);

  return jwt.sign((options.key ?? signingKey.privateKey) as CryptoKey);
}

function buildActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    serviceUrl: TRUSTED_SERVICE_URL,
    from: { aadObjectId: 'aad-user-1' },
    channelData: { tenant: { id: 'entra-tenant-1' } },
    ...overrides,
  };
}

function buildRequest(token: string | null, body: unknown): Request {
  return new Request('https://example.test/api/teams/bot/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('teamsInboundAuth', () => {
  beforeAll(async () => {
    signingKey = await generateKeyPair('RS256');
    rogueKey = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(signingKey.publicKey);
    jwksDocument = { keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] };
  });

  beforeEach(() => {
    process.env.TEAMS_BOT_APP_ID = BOT_APP_ID;
    process.env.TEAMS_BOT_APP_TENANT_ID = 'bot-tenant';
    process.env.TEAMS_BOT_APP_PASSWORD = 'bot-password';
    resetTeamsBotJwksCacheForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const href = String(url);
        if (href === OPENID_URL) {
          return jsonResponse({ jwks_uri: JWKS_URL, issuer: BOT_FRAMEWORK_ISSUER });
        }
        if (href === JWKS_URL) {
          return jsonResponse(jwksDocument);
        }
        throw new Error(`Unexpected fetch during test: ${href}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TEAMS_BOT_APP_ID;
    delete process.env.TEAMS_BOT_APP_TENANT_ID;
    delete process.env.TEAMS_BOT_APP_PASSWORD;
  });

  it('T001: accepts a valid Bot Framework JWT and returns verified claims', async () => {
    const token = await mintToken({ claims: { oid: 'aad-user-1', tid: 'entra-tenant-1' } });

    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity(),
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.identity.microsoftUserId).toBe('aad-user-1');
      expect(result.identity.microsoftTenantId).toBe('entra-tenant-1');
      expect(result.identity.serviceUrl).toBe(TRUSTED_SERVICE_URL);
      expect(result.identity.payload.aud).toBe(BOT_APP_ID);
    }
  });

  it('T002: rejects tokens with the wrong audience', async () => {
    const token = await mintToken({ audience: 'some-other-app' });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity(),
    });
    expect(result.status).toBe('rejected');
  });

  it('T002: rejects tokens with the wrong issuer', async () => {
    const token = await mintToken({ issuer: 'https://evil.example.com' });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity(),
    });
    expect(result.status).toBe('rejected');
  });

  it('T002: rejects expired tokens', async () => {
    const token = await mintToken({ expired: true });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity(),
    });
    expect(result.status).toBe('rejected');
  });

  it('T002: rejects tokens signed by an unknown key', async () => {
    const token = await mintToken({ key: rogueKey.privateKey });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity(),
    });
    expect(result.status).toBe('rejected');
  });

  it('T003: rejects activities whose serviceUrl is outside the trusted allow-list even with a valid JWT', async () => {
    const token = await mintToken({ claims: { serviceurl: 'https://evil.example.com' } });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity({ serviceUrl: 'https://evil.example.com' }),
    });
    expect(result).toEqual({ status: 'rejected', reason: 'untrusted_service_url' });
  });

  it('T003: rejects activities whose serviceUrl differs from the token serviceurl claim', async () => {
    const token = await mintToken();
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity({ serviceUrl: 'https://smba.trafficmanager.net/emea' }),
    });
    expect(result).toEqual({ status: 'rejected', reason: 'service_url_claim_mismatch' });
  });

  it('T010: rejects when from.aadObjectId differs from the verified oid claim', async () => {
    const token = await mintToken({ claims: { oid: 'aad-user-1' } });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity({ from: { aadObjectId: 'aad-user-9' } }),
    });
    expect(result).toEqual({ status: 'rejected', reason: 'aad_object_id_mismatch' });
  });

  it('T011: rejects when channelData.tenant.id differs from the verified tid claim', async () => {
    const token = await mintToken({ claims: { tid: 'entra-tenant-1' } });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity({ channelData: { tenant: { id: 'entra-tenant-9' } } }),
    });
    expect(result).toEqual({ status: 'rejected', reason: 'microsoft_tenant_mismatch' });
  });

  it('T012: sources identity from verified claims when body identity fields are absent', async () => {
    const token = await mintToken({ claims: { oid: 'claim-user-7', tid: 'claim-tenant-7' } });
    const result = await verifyTeamsInboundActivity({
      authorizationHeader: `Bearer ${token}`,
      activity: buildActivity({ from: null, channelData: null }),
    });
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.identity.microsoftUserId).toBe('claim-user-7');
      expect(result.identity.microsoftTenantId).toBe('claim-tenant-7');
    }
  });

  it('returns unconfigured when TEAMS_BOT_APP_* env vars are unset', async () => {
    delete process.env.TEAMS_BOT_APP_ID;
    delete process.env.TEAMS_BOT_APP_TENANT_ID;
    delete process.env.TEAMS_BOT_APP_PASSWORD;

    const result = await verifyTeamsInboundActivity({
      authorizationHeader: null,
      activity: buildActivity(),
    });
    expect(result).toEqual({ status: 'unconfigured', reason: 'bot_credentials_not_configured' });
  });

  it('checkTeamsActivityAgainstClaims accepts matching case-insensitive identity fields', () => {
    const result = checkTeamsActivityAgainstClaims(
      { oid: 'AAD-USER-1', tid: 'ENTRA-TENANT-1', serviceurl: TRUSTED_SERVICE_URL },
      buildActivity()
    );
    expect(result.status).toBe('verified');
  });

  describe('authenticateTeamsInboundRequest', () => {
    it('T008: fails closed with 403 when bot credentials are unconfigured', async () => {
      delete process.env.TEAMS_BOT_APP_ID;
      delete process.env.TEAMS_BOT_APP_TENANT_ID;
      delete process.env.TEAMS_BOT_APP_PASSWORD;

      const result = await authenticateTeamsInboundRequest(buildRequest(null, buildActivity()), 'bot');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        await expect(result.response.json()).resolves.toMatchObject({
          error: 'bot_connector_not_configured',
        });
      }
    });

    it('T004/T006: rejects requests without a bearer token with 401', async () => {
      const result = await authenticateTeamsInboundRequest(buildRequest(null, buildActivity()), 'bot');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it('returns 400 for invalid JSON bodies after a valid JWT', async () => {
      const token = await mintToken();
      const result = await authenticateTeamsInboundRequest(buildRequest(token, '{nope'), 'bot');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
      }
    });

    it('returns the parsed activity and verified identity for a valid request', async () => {
      const token = await mintToken({ claims: { oid: 'aad-user-1', tid: 'entra-tenant-1' } });
      const result = await authenticateTeamsInboundRequest(buildRequest(token, buildActivity()), 'bot');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.activity).toMatchObject({ type: 'message' });
        expect(result.identity.microsoftUserId).toBe('aad-user-1');
      }
    });
  });
});
