import http from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTeamsBotJwksCacheForTests, verifyTeamsBotRequest } from '../teamsBotJwtVerifier';

/**
 * The emulator stands in for login.botframework.com by publishing its own
 * OpenID config + JWKS and signing the activities it injects. This exercises
 * that redirection through the real verifier: only discovery moves, signature,
 * issuer, and audience checks all still run.
 */

const ISSUER = 'https://api.botframework.com';
const APP_ID = 'emulated-teams-bot-app-id';

let server: http.Server;
let baseUrl: string;
let signToken: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'emulator-key', use: 'sig', alg: 'RS256' };

  server = http
    .createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/.well-known/openidconfiguration') {
        res.end(JSON.stringify({ issuer: ISSUER, jwks_uri: `${baseUrl}/v1/.well-known/keys` }));
        return;
      }
      if (req.url === '/v1/.well-known/keys') {
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      res.writeHead(404).end('{}');
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  signToken = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'emulator-key' })
      .setIssuer(ISSUER)
      .setAudience(APP_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetTeamsBotJwksCacheForTests();
});

function configureBotCredentials(): void {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('TEAMS_BOT_APP_ID', APP_ID);
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', 'tenant-1');
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', 'secret');
}

function configureBot(): void {
  configureBotCredentials();
  vi.stubEnv('TEAMS_BOT_OPENID_CONFIG_URL', `${baseUrl}/v1/.well-known/openidconfiguration`);
}

describe('verifyTeamsBotRequest with TEAMS_BOT_OPENID_CONFIG_URL', () => {
  it('verifies a token signed by the redirected identity provider', async () => {
    configureBot();
    const token = await signToken({ oid: 'guest-1', tid: 'tenant-1', serviceurl: baseUrl });

    const result = await verifyTeamsBotRequest(`Bearer ${token}`);
    expect(result.status).toBe('verified');
    expect(result.status === 'verified' && result.payload).toMatchObject({
      oid: 'guest-1',
      serviceurl: baseUrl,
    });
  });

  it('still rejects a token whose audience is not the bot app id', async () => {
    configureBot();
    vi.stubEnv('TEAMS_BOT_APP_ID', 'another-app-id');

    const result = await verifyTeamsBotRequest(`Bearer ${await signToken({ oid: 'guest-1' })}`);
    expect(result.status).toBe('rejected');
  });

  it('still rejects a tampered signature', async () => {
    configureBot();
    const token = await signToken({ oid: 'guest-1' });
    const [header, payload, signature] = token.split('.');

    const result = await verifyTeamsBotRequest(
      `Bearer ${header}.${payload}.${signature.slice(0, -3)}abc`
    );
    expect(result.status).toBe('rejected');
  });

  it('ignores the override in production', async () => {
    configureBot();
    vi.stubEnv('NODE_ENV', 'production');

    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response('{}', { status: 500 });
    }) as typeof fetch;

    try {
      const result = await verifyTeamsBotRequest(`Bearer ${await signToken({ oid: 'guest-1' })}`);
      expect(result.status).toBe('rejected');
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(requested).toEqual([
      'https://login.botframework.com/v1/.well-known/openidconfiguration',
    ]);
  });
});

/**
 * A restarted emulator signs with a fresh keypair, so the discovered JWKS has to
 * go stale quickly on the override path — otherwise every injected activity is
 * rejected until the app restarts. The default path must keep the 12h TTL.
 *
 * Only Date.now is moved; jose reads expiry off `new Date()`, so the signed
 * tokens stay valid however far the cache clock is advanced.
 */
describe('JWKS cache TTL', () => {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  let clockOffsetMs = 0;

  beforeEach(() => {
    clockOffsetMs = 0;
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Counts discovery round trips, pointing the real Bot Framework host at the stub. */
  function trackFetches(): { count: () => number; restore: () => void } {
    const realFetch = globalThis.fetch;
    let count = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      count += 1;
      return realFetch(
        String(input).replace('https://login.botframework.com', baseUrl),
        init
      );
    }) as typeof fetch;
    return {
      count: () => count,
      restore: () => {
        globalThis.fetch = realFetch;
      },
    };
  }

  it('re-discovers within seconds while the override is active', async () => {
    configureBot();
    const token = await signToken({ oid: 'guest-1' });
    const fetches = trackFetches();

    try {
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(2);

      clockOffsetMs = 29_000;
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(2);

      clockOffsetMs = 31_000;
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(4);
    } finally {
      fetches.restore();
    }
  });

  it('keeps the 12h TTL when TEAMS_BOT_OPENID_CONFIG_URL is unset', async () => {
    configureBotCredentials();
    vi.stubEnv('TEAMS_BOT_OPENID_CONFIG_URL', '');
    const token = await signToken({ oid: 'guest-1' });
    const fetches = trackFetches();

    try {
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(2);

      // Far past the emulator TTL, still well inside the production one.
      clockOffsetMs = TWELVE_HOURS_MS - 1_000;
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(2);

      clockOffsetMs = TWELVE_HOURS_MS + 1_000;
      expect((await verifyTeamsBotRequest(`Bearer ${token}`)).status).toBe('verified');
      expect(fetches.count()).toBe(4);
    } finally {
      fetches.restore();
    }
  });
});
