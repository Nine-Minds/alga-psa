import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticateMcpAdmin: vi.fn(),
  createAgent: vi.fn(),
}));

vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => true }));
vi.mock('@product/mcp/entry', () => mocks);

describe('POST /api/v1/mcp/agents admission responses', () => {
  beforeEach(() => {
    mocks.authenticateMcpAdmin.mockReset().mockResolvedValue({ tenant: 'tenant-1', userId: 'admin-1' });
    mocks.createAgent.mockReset();
  });

  async function post() {
    const { POST } = await import('@/app/api/v1/mcp/agents/route');
    return POST(new NextRequest('http://localhost/api/v1/mcp/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Agent' }),
    }));
  }

  it.each([
    ['LicenseLimitError', 'SOLO_PLAN_LIMIT', 'Solo plan limit reached'],
    ['LicenseLimitError', 'LICENSE_LIMIT_REACHED', 'Licensed seats exhausted'],
    ['InternalUserSeatOverflowError', 'LICENSE_LIMIT_REACHED', 'Seat occupancy exceeded'],
  ])('returns 403 for seat rejection %s/%s', async (name, code, message) => {
    mocks.createAgent.mockRejectedValue(Object.assign(new Error(message), { name, code, statusCode: 403 }));

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: message, code });
  });

  it('returns 403 for co-managed admission rejection', async () => {
    mocks.createAgent.mockRejectedValue(Object.assign(new Error('Allocation full'), {
      name: 'CoManagedAdmissionError', code: 'CO_MANAGED_SEAT_LIMIT',
    }));

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Allocation full', code: 'CO_MANAGED_SEAT_LIMIT' });
  });

  it('keeps duplicate IdP binding as 409', async () => {
    mocks.createAgent.mockRejectedValue(Object.assign(new Error('Already bound'), { name: 'AgentBindingConflictError' }));

    const response = await post();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Already bound' });
  });
});
