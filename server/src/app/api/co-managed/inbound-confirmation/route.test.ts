import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), approve: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.currentUser }));
vi.mock('@alga-psa/co-managed/deliveryRegistration', () => ({}));
vi.mock('@alga-psa/co-managed/inboundSenderConfirmation', () => ({
  parseInboundSenderConfirmationToken: (token: string) => token === 'valid-token'
    ? { tenant: 'tenant-1', sourceId: '00000000-0000-4000-8000-000000000001', expiresAt: '2030-01-01T00:00:00.000Z' }
    : null,
  approveInboundSenderConfirmation: mocks.approve,
}));
vi.mock('@alga-psa/db', () => ({
  getAdminConnection: async () => ({}),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({
    recipient: 'alice@example.test',
    payload: { expiresAt: '2030-01-01T00:00:00.000Z', state: 'pending', actor: { tenant: 'tenant-1', userId: 'alice' }, ticketId: 'ticket-1', text: 'reply', },
  }) }) }) }),
}));

import { GET, POST } from './route';

describe('inbound sender confirmation HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ tenant: 'tenant-1', user_id: 'alice', user_type: 'internal', email: 'alice@example.test' });
    mocks.approve.mockResolvedValue({ ticketId: 'ticket-1', commentId: 'comment-1' });
  });

  it('requires the intended authenticated internal user for the confirmation page', async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    const response = await GET(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Sign in as the intended internal user');
    expect(mocks.approve).not.toHaveBeenCalled();

    mocks.currentUser.mockResolvedValueOnce({ tenant: 'tenant-2', user_id: 'alice', user_type: 'internal', email: 'alice@example.test' });
    const wrongActor = await GET(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token'));
    expect(wrongActor.status).toBe(403);
  });

  it('rejects cross-origin POSTs and writes only for a same-origin authenticated confirmation', async () => {
    const crossOrigin = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://attacker.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();

    mocks.currentUser.mockResolvedValueOnce(null);
    const anonymous = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(anonymous.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();

    const accepted = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(accepted.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });
});
