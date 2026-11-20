import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  authorizeTicketRecordAccess: vi.fn(), hasPermission: vi.fn(), getConnection: vi.fn(), admitSeatTrialCredential: vi.fn(),
}));
const { authorizeTicketRecordAccess, hasPermission, getConnection, admitSeatTrialCredential } = mocks;
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: mocks.authorizeTicketRecordAccess }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/db/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('@enterprise/lib/co-managed/seatTrialSession', () => ({ admitSeatTrialCredential: mocks.admitSeatTrialCredential }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const row = name === 'users'
        ? { user_id: 'user-a', user_type: 'internal', timezone: 'UTC', is_inactive: false }
        : { ticket_id: 'ticket-a', board_id: 'board-a', status_id: 'status-a', assigned_to: 'user-b', title: 'visible title', description: 'visible description', private_notes: 'must never escape' };
      const builder: any = {
        where: () => builder,
        first: async () => name === 'statuses' ? { is_closed: false, name: 'Open' } : name === 'boards' ? { is_inactive: false } : row,
        pluck: async () => [],
        select: async () => [],
      };
      return builder;
    },
    tenantJoin: () => ({ where: () => ({ select: async () => [] }) }),
  }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));

import { HEAD, POST } from '../../../app/api/internal/tickets/live-change/route';

async function post() {
  return POST(new Request('http://localhost/api/internal/tickets/live-change', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify({ tenantId: 'tenant-a', userId: 'user-a', ticketId: 'ticket-a', event: { changeKind: 'updated', updatedAt: '2026-11-02T12:00:00Z', actorUserId: 'user-b' } }),
  }) as any);
}

const signingSecret = 'ticket-change-test-secret';

function signedRelay(audience = 'ticket-live-access', expiresIn = 15) {
  return jwt.sign({ ticketReader: { tenantId: 'tenant-a', userId: 'user-a', ticketId: 'ticket-a' } },
    signingSecret, { algorithm: 'HS256', audience, expiresIn });
}

async function head(key = signedRelay()) {
  return HEAD(new Request('http://localhost/api/internal/tickets/live-change', {
    method: 'HEAD',
    headers: { 'x-api-key': key },
  }) as any);
}

describe('ticket live change recipient authorization', () => {
  beforeEach(() => {
    process.env.COLLAB_PERSIST_API_KEY = 'secret';
    process.env.HOCUSPOCUS_JWT_SECRET = signingSecret;
    hasPermission.mockResolvedValue(true);
    getConnection.mockResolvedValue({});
    authorizeTicketRecordAccess.mockReset();
    admitSeatTrialCredential.mockReset().mockResolvedValue(true);
  });

  it('returns no ticket identity or metadata when record read authorization denies the recipient', async () => {
    authorizeTicketRecordAccess.mockRejectedValue(new Error('Permission denied: ticket read not allowed'));
    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ change: null });
  });

  it('returns only filter-safe enrichment after authorized record access', async () => {
    authorizeTicketRecordAccess.mockResolvedValue(undefined);
    const response = await post();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.change).toMatchObject({ ticketId: 'ticket-a', boardId: 'board-a', statusId: 'status-a', primaryAssigneeId: 'user-b' });
    expect(JSON.stringify(payload)).not.toContain('must never escape');
  });

  it('requires a current ticket access credential before checking a room', async () => {
    expect((await head('secret')).status).toBe(401);
    expect((await head(signedRelay('ticket-changes'))).status).toBe(401);
    expect((await head(signedRelay('ticket-live-access', -1))).status).toBe(401);
    expect(admitSeatTrialCredential).not.toHaveBeenCalled();
  });

  it('denies the relay when the shared Seat admission check denies', async () => {
    admitSeatTrialCredential.mockResolvedValue(false);
    expect((await head()).status).toBe(403);
    expect(admitSeatTrialCredential).toHaveBeenCalledWith('tenant-a', 'user-a', expect.any(Object));
    expect(authorizeTicketRecordAccess).not.toHaveBeenCalled();
  });

  it('rechecks ticket scope for an admitted relay recipient', async () => {
    authorizeTicketRecordAccess.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Permission denied: ticket moved outside scope'));
    const allowed = await head();
    expect(allowed.status).toBe(204);
    expect(await allowed.text()).toBe('');
    expect((await head()).status).toBe(403);
  });
});
