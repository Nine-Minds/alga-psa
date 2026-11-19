import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeTicketRecordAccess: vi.fn(), hasPermission: vi.fn(), getConnection: vi.fn(),
}));
const { authorizeTicketRecordAccess, hasPermission, getConnection } = mocks;
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: mocks.authorizeTicketRecordAccess }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/db/db', () => ({ getConnection: mocks.getConnection }));
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

import { POST } from '../../../app/api/internal/tickets/live-change/route';

async function post() {
  return POST(new Request('http://localhost/api/internal/tickets/live-change', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify({ tenantId: 'tenant-a', userId: 'user-a', ticketId: 'ticket-a', event: { changeKind: 'updated', updatedAt: '2026-11-02T12:00:00Z', actorUserId: 'user-b' } }),
  }) as any);
}

describe('ticket live change recipient authorization', () => {
  beforeEach(() => {
    process.env.COLLAB_PERSIST_API_KEY = 'secret';
    hasPermission.mockResolvedValue(true);
    getConnection.mockResolvedValue({});
    authorizeTicketRecordAccess.mockReset();
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
});
