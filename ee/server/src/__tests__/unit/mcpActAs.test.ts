// T024 (F068, F090): MCP tools/call with act_as_user_id forwards X-Alga-Act-As and audits it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateAgentToken: vi.fn(),
  mintAgentSessionKey: vi.fn(),
  writeAgentAudit: vi.fn(),
  loadMcpRegistry: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@alga-psa/agent-tooling', () => ({
  runRegistrySearch: vi.fn(),
  buildRequest: vi.fn(),
  buildMetaToolDefinitions: vi.fn(() => []),
  SEARCH_API_REGISTRY_TOOL: 'search_api_registry',
  SEARCH_BUSINESS_DATA_TOOL: 'search_business_data',
  CALL_API_ENDPOINT_TOOL: 'call_api_endpoint',
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: { validateApiKeyAnyTenant: vi.fn() } }));
vi.mock('@/lib/mcp/loadRegistry', () => ({ loadMcpRegistry: mocks.loadMcpRegistry }));
vi.mock('../../lib/mcp/idpToken', () => ({
  authenticateAgentToken: mocks.authenticateAgentToken,
  looksLikeJwt: () => true,
}));
vi.mock('../../lib/mcp/agents', () => ({ mintAgentSessionKey: mocks.mintAgentSessionKey }));
vi.mock('../../lib/mcp/agentAudit', () => ({ writeAgentAudit: mocks.writeAgentAudit }));
vi.mock('../../lib/mcp/baseUrl', () => ({
  resolvePublicBaseUrl: vi.fn(),
  resolveInternalBaseUrl: () => 'http://internal',
}));
vi.mock('../../lib/mcp/oauth/tokens', () => ({ looksLikeAlgaToken: () => false, verifyAccessToken: vi.fn() }));
vi.mock('../../lib/mcp/oauth/grants', () => ({ isGrantActive: vi.fn() }));
vi.mock('../../lib/mcp/oauth/userSession', () => ({ mintUserSessionKey: vi.fn() }));

import { handleMcpJsonRpc } from '../../lib/mcp/jsonRpcServer';

const HUMAN = '33333333-3333-3333-3333-333333333333';

function rpc(args: Record<string, unknown>) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? 'Bearer a.b.c' : null) },
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_business_data', arguments: { query: 'x', ...args } },
    }),
  } as never;
}

describe('MCP act_as_user_id (T024)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAgentToken.mockResolvedValue({
      ok: true,
      ctx: { resolved: { tenant: 't1', backingUserId: 'svc-1', agent: { agent_id: 'agent-1' } } },
    });
    mocks.mintAgentSessionKey.mockResolvedValue('session-key');
    mocks.loadMcpRegistry.mockResolvedValue({ entries: [] });
    mocks.fetch.mockResolvedValue({ status: 200, ok: true, text: async () => '{"ok":true}' });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('forwards the act-as header and audits the acted-as user', async () => {
    await handleMcpJsonRpc(rpc({ act_as_user_id: HUMAN }));
    const [, init] = mocks.fetch.mock.calls[0];
    expect(init.headers['x-alga-act-as']).toBe(HUMAN);
    expect(init.headers['x-api-key']).toBe('session-key');
    expect(mocks.writeAgentAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 't1', agentId: 'agent-1', actAsUserId: HUMAN, ok: true }),
    );
  });

  it('sends no header and audits null without act_as_user_id', async () => {
    await handleMcpJsonRpc(rpc({}));
    const [, init] = mocks.fetch.mock.calls[0];
    expect(init.headers['x-alga-act-as']).toBeUndefined();
    expect(mocks.writeAgentAudit).toHaveBeenCalledWith(expect.objectContaining({ actAsUserId: null }));
  });
});
