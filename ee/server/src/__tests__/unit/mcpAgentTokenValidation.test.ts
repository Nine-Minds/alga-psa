import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/**
 * MCP agent-token validation round-trip (easy-path F012, Tier 2 built-ins).
 *
 * The high-value "mock-IdP round-trip" test: a REAL RS256 token signed by a
 * local JWKS is driven through the actual jose pipeline in authenticateAgentToken.
 * Only the DB seams (trusted-IdP lookup, agent resolution) are mocked, so this
 * exercises the new candidate-merge logic — registered agent_idp_providers rows
 * PLUS the hosted built-in path, including the `tenant: null` skip that lets a
 * built-in issuer bind an agent in any tenant.
 */

// DB + built-in seams are mocked; everything else (jose verify, candidate merge) is real.
vi.mock('@ee/lib/mcp/agents', () => ({
  findTrustedIdpsByIssuer: vi.fn(),
  resolveAgentByIdp: vi.fn(),
}));
vi.mock('@ee/lib/mcp/idpBuiltins', () => ({
  getBuiltinIdpForIssuer: vi.fn(),
}));

import { authenticateAgentToken } from '@ee/lib/mcp/idpToken';
import { findTrustedIdpsByIssuer, resolveAgentByIdp } from '@ee/lib/mcp/agents';
import { getBuiltinIdpForIssuer } from '@ee/lib/mcp/idpBuiltins';

const mFindIdps = vi.mocked(findTrustedIdpsByIssuer);
const mResolveAgent = vi.mocked(resolveAgentByIdp);
const mBuiltin = vi.mocked(getBuiltinIdpForIssuer);

const ISSUER = 'https://idp.example.test/tenant-1';
let privateKey: CryptoKey;
let server: http.Server;
let jwksUri: string;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mBuiltin.mockResolvedValue(null);
  mFindIdps.mockResolvedValue([]);
});

async function sign(opts: {
  sub?: string;
  aud?: string;
  iss?: string;
  extra?: Record<string, unknown>;
}): Promise<string> {
  let jwt = new SignJWT({ ...(opts.extra ?? {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.iss ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m');
  if (opts.sub) jwt = jwt.setSubject(opts.sub);
  if (opts.aud) jwt = jwt.setAudience(opts.aud);
  return jwt.sign(privateKey);
}

function row(over: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    issuer: ISSUER,
    jwks_uri: jwksUri,
    audience: 'mcp-resource',
    subject_claim: 'sub',
    kind: 'custom',
    entra_tenant_id: null,
    active: true,
    ...over,
  };
}

function agent(over: Record<string, unknown> = {}) {
  return {
    agent: { agent_id: 'a1', name: 'Triage bot', tenant: 'tenant-1' },
    tenant: 'tenant-1',
    backingUserId: 'user-1',
    ...over,
  } as never;
}

describe('authenticateAgentToken — registered IdP row', () => {
  it('validates a real token and resolves the bound agent', async () => {
    mFindIdps.mockResolvedValue([row()] as never);
    mResolveAgent.mockResolvedValue(agent());
    const token = await sign({ sub: 'agent-subject-1', aud: 'mcp-resource' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(true);
    expect(mResolveAgent).toHaveBeenCalledWith(ISSUER, 'agent-subject-1');
    if (res.ok) expect(res.ctx.resolved.backingUserId).toBe('user-1');
  });

  it('rejects a token whose audience does not match the row (403)', async () => {
    mFindIdps.mockResolvedValue([row({ audience: 'expected-aud' })] as never);
    mResolveAgent.mockResolvedValue(agent());
    const token = await sign({ sub: 'agent-subject-1', aud: 'wrong-aud' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.status).toBe(403);
  });

  it('enforces the agent/IdP tenant match for registered rows (403)', async () => {
    mFindIdps.mockResolvedValue([row({ tenant: 'tenant-1' })] as never);
    mResolveAgent.mockResolvedValue(agent({ tenant: 'tenant-2' }));
    const token = await sign({ sub: 'agent-subject-1', aud: 'mcp-resource' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/tenant mismatch/i);
  });

  it('selects the subject from a non-default claim (azp)', async () => {
    mFindIdps.mockResolvedValue([row({ subject_claim: 'azp' })] as never);
    mResolveAgent.mockResolvedValue(agent());
    const token = await sign({ sub: 'ignore-me', aud: 'mcp-resource', extra: { azp: 'app-123' } });

    await authenticateAgentToken(token);
    expect(mResolveAgent).toHaveBeenCalledWith(ISSUER, 'app-123');
  });

  it('fails when the resolved agent has no backing identity (403)', async () => {
    mFindIdps.mockResolvedValue([row()] as never);
    mResolveAgent.mockResolvedValue(agent({ backingUserId: null }));
    const token = await sign({ sub: 'agent-subject-1', aud: 'mcp-resource' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/backing identity/i);
  });
});

describe('authenticateAgentToken — hosted built-in (Tier 2)', () => {
  it('validates against a built-in with no registered row and skips the tenant match', async () => {
    mFindIdps.mockResolvedValue([]); // no agent_idp_providers row
    mBuiltin.mockResolvedValue({ jwksUri, audience: 'mcp-resource', subjectClaim: 'sub' });
    // The agent lives in a tenant unrelated to any row — built-in is instance-wide.
    mResolveAgent.mockResolvedValue(agent({ tenant: 'some-hosted-tenant' }));
    const token = await sign({ sub: 'google-sa-sub', aud: 'mcp-resource' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ctx.resolved.tenant).toBe('some-hosted-tenant');
  });

  it('returns 401 when the issuer is neither a registered row nor a built-in', async () => {
    mFindIdps.mockResolvedValue([]);
    mBuiltin.mockResolvedValue(null);
    const token = await sign({ sub: 'x', aud: 'mcp-resource' });

    const res = await authenticateAgentToken(token);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.status).toBe(401);
      expect(res.error).toMatch(/untrusted token issuer/i);
    }
  });
});

describe('authenticateAgentToken — fails closed without an audience', () => {
  for (const [label, audience] of [['null', null], ['blank', ''], ['whitespace', '   ']] as const) {
    it(`rejects a registered row with ${label} audience even for a validly signed token with an unrelated aud (403)`, async () => {
      mFindIdps.mockResolvedValue([row({ audience })] as never);
      mResolveAgent.mockResolvedValue(agent());
      const token = await sign({ sub: 'agent-subject-1', aud: 'some-other-app' });

      const res = await authenticateAgentToken(token);
      expect(res.ok).toBe(false);
      if (res.ok === false) {
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/audience/i);
      }
      expect(mResolveAgent).not.toHaveBeenCalled();
    });
  }

  it('control: audience X accepts aud X and rejects aud Y', async () => {
    mFindIdps.mockResolvedValue([row({ audience: 'X' })] as never);
    mResolveAgent.mockResolvedValue(agent());
    const ok = await authenticateAgentToken(await sign({ sub: 's', aud: 'X' }));
    expect(ok.ok).toBe(true);
    const bad = await authenticateAgentToken(await sign({ sub: 's', aud: 'Y' }));
    expect(bad.ok).toBe(false);
    if (bad.ok === false) expect(bad.status).toBe(403);
  });

  it('skips a built-in candidate with a null audience', async () => {
    mFindIdps.mockResolvedValue([]);
    mBuiltin.mockResolvedValue({ jwksUri, audience: null, subjectClaim: 'sub' });
    mResolveAgent.mockResolvedValue(agent());
    const res = await authenticateAgentToken(await sign({ sub: 's', aud: 'whatever' }));
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.status).toBe(403);
    expect(mResolveAgent).not.toHaveBeenCalled();
  });

  it('still authenticates via a usable candidate when another has no audience', async () => {
    mFindIdps.mockResolvedValue([row({ audience: null }), row({ audience: 'X' })] as never);
    mResolveAgent.mockResolvedValue(agent());
    const res = await authenticateAgentToken(await sign({ sub: 's', aud: 'X' }));
    expect(res.ok).toBe(true);
  });
});

describe('authenticateAgentToken — malformed input', () => {
  it('rejects a non-JWT bearer token (401)', async () => {
    const res = await authenticateAgentToken('not-a-jwt');
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.status).toBe(401);
  });
});
