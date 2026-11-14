// S12 F030: an MCP request from a seat principal is refused, at the OAuth user path, before any key is minted
// or any tool dispatched.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCredentialsRefusedError } from '@alga-psa/authorization/subject/principalKind';

const mocks = vi.hoisted(() => ({
  mayHoldApiCredentials: vi.fn(),
  verifyAccessToken: vi.fn(),
  isGrantActive: vi.fn(),
  inserts: [] as unknown[],
  fetch: vi.fn(),
}));

vi.mock('@alga-psa/authorization/subject/principalKind', async (importOriginal) => ({
  ...(await importOriginal() as typeof import('@alga-psa/authorization/subject/principalKind')),
  mayHoldApiCredentials: (...args: unknown[]) => mocks.mayHoldApiCredentials(...args),
}));
vi.mock('@/lib/db', () => {
  const table: any = () => {
    const builder: any = {
      where: () => builder,
      whereNotNull: () => builder,
      del: async () => 0,
      insert: async (row: unknown) => { mocks.inserts.push(row); },
    };
    return builder;
  };
  (table as any).raw = () => 'raw';
  return {
    createTenantKnex: async () => ({ knex: Object.assign(table, { fn: { now: () => 'now()' } }) }),
    runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  };
});
vi.mock('@alga-psa/agent-tooling', async (importOriginal) => ({
  ...await importOriginal() as typeof import('@alga-psa/agent-tooling'),
  buildMetaToolDefinitions: vi.fn(() => []),
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: { validateApiKeyAnyTenant: vi.fn() } }));
vi.mock('@/lib/mcp/loadRegistry', () => ({ loadMcpRegistry: vi.fn(async () => []) }));
vi.mock('../../lib/mcp/idpToken', () => ({ authenticateAgentToken: vi.fn(), looksLikeJwt: () => false }));
vi.mock('../../lib/mcp/agents', () => ({ mintAgentSessionKey: vi.fn() }));
vi.mock('../../lib/mcp/agentAudit', () => ({ writeAgentAudit: vi.fn() }));
vi.mock('../../lib/mcp/baseUrl', () => ({
  resolvePublicBaseUrl: vi.fn(async () => 'http://public'),
  resolveInternalBaseUrl: () => 'http://internal',
}));
vi.mock('../../lib/mcp/oauth/tokens', () => ({
  looksLikeAlgaToken: () => true,
  verifyAccessToken: (...args: unknown[]) => mocks.verifyAccessToken(...args),
}));
vi.mock('../../lib/mcp/oauth/grants', () => ({ isGrantActive: (...args: unknown[]) => mocks.isGrantActive(...args) }));

import { handleMcpJsonRpc } from '../../lib/mcp/jsonRpcServer';
import { mintUserSessionKey } from '../../lib/mcp/oauth/userSession';

const request = () => ({
  headers: { get: (key: string) => (key === 'authorization' ? 'Bearer alga-token' : null) },
  json: async () => ({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}) as never;

describe('MCP refuses a seat principal (S12 F030)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.verifyAccessToken.mockResolvedValue({ tenant: 't1', userId: 'seat-user', grantId: 'g1' });
    mocks.isGrantActive.mockResolvedValue(true);
    mocks.mayHoldApiCredentials.mockResolvedValue(true);
  });

  it('answers 403 for a valid, active grant held by a seat principal, and mints no key', async () => {
    mocks.mayHoldApiCredentials.mockResolvedValue(false);

    const response = await handleMcpJsonRpc(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'MCP is not available for this account' });
    expect(mocks.inserts).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.mayHoldApiCredentials).toHaveBeenCalledWith(expect.anything(), { tenant: 't1', userId: 'seat-user' });
  });

  it('mintUserSessionKey itself refuses, so no other caller can mint a session for a seat principal', async () => {
    mocks.mayHoldApiCredentials.mockResolvedValue(false);

    await expect(mintUserSessionKey({ tenant: 't1', userId: 'seat-user' })).rejects.toBeInstanceOf(ApiCredentialsRefusedError);
    expect(mocks.inserts).toEqual([]);
  });

  it('still serves an ordinary principal', async () => {
    const response = await handleMcpJsonRpc(request());

    expect(response.status).toBe(200);
    expect(mocks.inserts).toHaveLength(1);
  });
});
