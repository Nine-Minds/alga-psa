import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const getCurrentUserMock = vi.fn();
const authMock = vi.fn();
const getUserWithRolesMock = vi.fn();
const getTicketByIdMock = vi.fn();
const getHocuspocusJwtSecretMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
  getNextAuthSecret: vi.fn().mockResolvedValue('test-nextauth-secret'),
  getSessionCookieName: vi.fn().mockReturnValue('authjs.session-token'),
}));

vi.mock('../../../app/api/auth/[...nextauth]/auth', () => ({
  auth: () => authMock(),
}));

vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: (...args: unknown[]) => getUserWithRolesMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
}));

vi.mock('@/lib/hocuspocusJwt', () => ({
  getHocuspocusJwtSecret: () => getHocuspocusJwtSecretMock(),
}));

describe('ticket live-token route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHocuspocusJwtSecretMock.mockResolvedValue('live-ticket-secret');
    authMock.mockResolvedValue(null);
    getUserWithRolesMock.mockResolvedValue(null);
  });

  it('T008: returns 401 when the session user is missing', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const { GET } = await import('../../../app/api/tickets/[id]/live-token/route');

    const response = await GET(new Request('http://localhost/api/tickets/ticket-1/live-token') as any, {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(401);
    expect(getTicketByIdMock).not.toHaveBeenCalled();
  });

  it('T009: returns 403 when the user cannot read the ticket', async () => {
    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    getTicketByIdMock.mockRejectedValue(new Error('Permission denied: Cannot read ticket'));

    const { GET } = await import('../../../app/api/tickets/[id]/live-token/route');
    const response = await GET(new Request('http://localhost/api/tickets/ticket-1/live-token') as any, {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(403);
  });

  it('T010: returns a JWT with tenant, user, and ticket claims and a <= 5 minute TTL', async () => {
    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    getTicketByIdMock.mockResolvedValue({ ticket_id: 'ticket-1' });

    const { GET } = await import('../../../app/api/tickets/[id]/live-token/route');
    const response = await GET(new Request('http://localhost/api/tickets/ticket-1/live-token') as any, {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const decoded = jwt.verify(body.token, 'live-ticket-secret') as jwt.JwtPayload;

    expect(decoded.tenantId).toBe('tenant-1');
    expect(decoded.userId).toBe('user-1');
    expect(decoded.ticketId).toBe('ticket-1');
    expect(typeof decoded.jti).toBe('string');
    expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBeLessThanOrEqual(5 * 60);
  });

  it('falls back to the NextAuth session when getCurrentUser is unavailable', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    authMock.mockResolvedValue({
      user: {
        id: 'user-2',
        tenant: 'tenant-2',
      },
    });
    getUserWithRolesMock.mockResolvedValue({
      user_id: 'user-2',
      tenant: 'tenant-2',
    });
    getTicketByIdMock.mockResolvedValue({ ticket_id: 'ticket-2' });

    const { GET } = await import('../../../app/api/tickets/[id]/live-token/route');
    const response = await GET(new Request('http://localhost/api/tickets/ticket-2/live-token') as any, {
      params: Promise.resolve({ id: 'ticket-2' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const decoded = jwt.verify(body.token, 'live-ticket-secret') as jwt.JwtPayload;

    expect(getUserWithRolesMock).toHaveBeenCalledWith('user-2', 'tenant-2');
    expect(decoded.tenantId).toBe('tenant-2');
    expect(decoded.userId).toBe('user-2');
    expect(decoded.ticketId).toBe('ticket-2');
  });

  it('T054: refuses to mint a live token for a same-tenant ticket the user cannot access', async () => {
    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    getTicketByIdMock.mockRejectedValue(new Error('Permission denied: Cannot view ticket'));

    const { GET } = await import('../../../app/api/tickets/[id]/live-token/route');
    const response = await GET(new Request('http://localhost/api/tickets/ticket-secret/live-token') as any, {
      params: Promise.resolve({ id: 'ticket-secret' }),
    });

    expect(response.status).toBe(403);
  });
});
