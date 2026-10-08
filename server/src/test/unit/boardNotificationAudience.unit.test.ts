import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserWithRoles = vi.fn();
const hasPermission = vi.fn();
const authorizeTicketRecordAccess = vi.fn();

vi.mock('@alga-psa/db', () => ({ getUserWithRoles: (...a: any[]) => getUserWithRoles(...a) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...a: any[]) => hasPermission(...a) }));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: (...a: any[]) => authorizeTicketRecordAccess(...a),
}));

import { filterRecipientsWhoCanReadTicket } from '../../lib/notifications/boardNotificationAudience';

const recipients = [{ userId: 'u1' }, { userId: 'u2' }] as any[];
const run = () => filterRecipientsWhoCanReadTicket({} as any, 'tenant', 'ticket', recipients);

describe('filterRecipientsWhoCanReadTicket', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserWithRoles.mockImplementation(async (id: string) => ({ user_id: id }));
    hasPermission.mockResolvedValue(true);
    authorizeTicketRecordAccess.mockResolvedValue({});
  });

  it('keeps recipients that pass both checks', async () => {
    expect(await run()).toHaveLength(2);
  });

  it('drops a recipient denied by RBAC or by the record policy', async () => {
    hasPermission.mockImplementation(async (user: any) => user.user_id !== 'u1');
    expect((await run()).map((r) => r.userId)).toEqual(['u2']);

    hasPermission.mockResolvedValue(true);
    authorizeTicketRecordAccess.mockImplementation(async ({ user }: any) => {
      if (user.user_id === 'u2') throw new Error('Permission denied: Cannot access ticket');
      return {};
    });
    expect((await run()).map((r) => r.userId)).toEqual(['u1']);
  });

  it('drops a recipient that no longer resolves to a user', async () => {
    getUserWithRoles.mockResolvedValueOnce(null);
    expect((await run()).map((r) => r.userId)).toEqual(['u2']);
  });

  it('propagates any error that is not an access denial (e.g. a database error)', async () => {
    authorizeTicketRecordAccess.mockRejectedValue(new Error('current transaction is aborted, commands ignored until end of transaction block'));
    await expect(run()).rejects.toThrow('transaction is aborted');

    authorizeTicketRecordAccess.mockResolvedValue({});
    hasPermission.mockRejectedValue(new Error('connection terminated'));
    await expect(run()).rejects.toThrow('connection terminated');
  });
});
