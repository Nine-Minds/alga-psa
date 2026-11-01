import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Errors cross the @product/mcp/entry seam as plain Errors (class identity erased).
function shaped(name: string, message: string, code?: string, statusCode?: number): Error {
  return Object.assign(new Error(message), { name, code, statusCode });
}

const createAgent = vi.fn();
const setAgentActive = vi.fn();
const deleteAgent = vi.fn();

vi.mock('@product/mcp/entry', () => ({
  authenticateMcpAdmin: vi.fn(async () => ({ tenant: 't1', userId: 'u1' })),
  listAgents: vi.fn(),
  createAgent: (...a: unknown[]) => createAgent(...a),
  setAgentActive: (...a: unknown[]) => setAgentActive(...a),
  deleteAgent: (...a: unknown[]) => deleteAgent(...a),
}));

const LIMIT_MSG = 'Your plan allows 10 active service users.';
const limitError = () => shaped('ServicePrincipalLimitReachedError', LIMIT_MSG, 'SERVICE_PRINCIPAL_LIMIT_REACHED', 409);
const tierError = () => shaped('TierAccessError', 'Upgrade required', 'TIER_ACCESS_DENIED', 403);

const post = () =>
  new NextRequest('http://localhost/api/v1/mcp/agents', { method: 'POST', body: JSON.stringify({ name: 'a' }) });
const patch = () =>
  new NextRequest('http://localhost/api/v1/mcp/agents', {
    method: 'PATCH',
    body: JSON.stringify({ agentId: 'a1', active: true }),
  });

describe('MCP agents route error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  });

  it('POST maps the limit error to 409 with message and code', async () => {
    createAgent.mockRejectedValue(limitError());
    const { POST } = await import('@/app/api/v1/mcp/agents/route');
    const res = await POST(post());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: LIMIT_MSG, code: 'SERVICE_PRINCIPAL_LIMIT_REACHED' });
  });

  it('PATCH maps the limit error to 409 with message and code', async () => {
    setAgentActive.mockRejectedValue(limitError());
    const { PATCH } = await import('@/app/api/v1/mcp/agents/route');
    const res = await PATCH(patch());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: LIMIT_MSG, code: 'SERVICE_PRINCIPAL_LIMIT_REACHED' });
  });

  it('maps tier errors to 403 TIER_ACCESS_DENIED', async () => {
    createAgent.mockRejectedValue(tierError());
    const { POST } = await import('@/app/api/v1/mcp/agents/route');
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Upgrade required', code: 'TIER_ACCESS_DENIED' });
  });

  it('maps a generic coded 4xx error and keeps the binding-conflict 409', async () => {
    createAgent.mockRejectedValueOnce(shaped('ServicePrincipalError', 'bad', 'SP_INVALID', 422));
    const { POST } = await import('@/app/api/v1/mcp/agents/route');
    const res = await POST(post());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'bad', code: 'SP_INVALID' });

    createAgent.mockRejectedValueOnce(shaped('AgentBindingConflictError', 'already bound'));
    const conflict = await POST(post());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'already bound' });
  });

  it('rethrows unknown errors (500 behaviour unchanged)', async () => {
    const boom = new Error('boom');
    createAgent.mockRejectedValue(boom);
    setAgentActive.mockRejectedValue(shaped('Whatever', 'server fault', 'X', 500));
    const { POST, PATCH } = await import('@/app/api/v1/mcp/agents/route');
    await expect(POST(post())).rejects.toBe(boom);
    await expect(PATCH(patch())).rejects.toThrow('server fault');
  });
});
