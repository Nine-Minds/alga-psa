// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTicketActivityRows, getTicketTimelineEntries } from './ticketActivityActions';

let currentUser: any;
const calls: string[] = [];
const hasPermissionMock = vi.fn();
const authorizeMock = vi.fn();
const buildTimelineMock = vi.fn();
const readActivityMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: any, fn: any) => fn({ isTransaction: true }),
}));
vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: (...args: any[]) => authorizeMock(...args),
}));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  buildUnifiedTicketTimeline: (...args: any[]) => buildTimelineMock(...args),
  readTicketActivity: (...args: any[]) => readActivityMock(...args),
}));

const actions: Array<[string, (id: string) => Promise<any>]> = [
  ['getTicketTimelineEntries', (id) => (getTicketTimelineEntries as any)(id)],
  ['getTicketActivityRows', (id) => (getTicketActivityRows as any)(id)],
];

describe.each(actions)('%s record-level authorization', (_name, run) => {
  beforeEach(() => {
    currentUser = { user_id: 'u1', user_type: 'internal' };
    calls.length = 0;
    hasPermissionMock.mockReset().mockImplementation(async () => { calls.push('rbac'); return true; });
    authorizeMock.mockReset().mockImplementation(async (i: any) => { calls.push('kernel'); return { ticket_id: i.ticketId }; });
    buildTimelineMock.mockReset().mockImplementation(async () => { calls.push('builder'); return [{ id: 'row' }]; });
    readActivityMock.mockReset().mockImplementation(async () => { calls.push('builder'); return [{ id: 'row' }]; });
  });

  const builders = () => [buildTimelineMock, readActivityMock];

  it('returns TICKET_NOT_FOUND and reads nothing when the kernel denies an internal user', async () => {
    authorizeMock.mockRejectedValue(new Error('Ticket not found'));
    const result = await run('t1');
    expect(result).toMatchObject({ actionError: expect.stringContaining('Ticket not found'), messageKey: 'features/tickets:errors.action.ticketNotFound' });
    builders().forEach((b) => expect(b).not.toHaveBeenCalled());
  });

  it('asks the helper for read access with conceal: all', async () => {
    await run('t1');
    expect(authorizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'tenant-1', ticketId: 't1', action: 'read', conceal: 'all' }),
    );
  });

  it('gives identical payloads for a missing and a policy-hidden ticket', async () => {
    // Helper: missing ticket throws 'Ticket not found'; with conceal 'all' a kernel denial
    // is remapped to the very same error.
    authorizeMock.mockRejectedValue(new Error('Ticket not found'));
    const missing = await run('missing');
    authorizeMock.mockRejectedValue(new Error('Ticket not found'));
    const hidden = await run('hidden');
    expect(hidden).toEqual(missing);
  });

  it('passes the authorized ticket id to the builder and returns its rows', async () => {
    authorizeMock.mockResolvedValue({ ticket_id: 'authorized-id' });
    const result = await run('t1');
    expect(result).toEqual([{ id: 'row' }]);
    const used = [buildTimelineMock, readActivityMock].find((b) => b.mock.calls.length)!;
    expect(used.mock.calls[0][2]).toBe('authorized-id');
  });

  it('rejects client principals before the kernel is consulted', async () => {
    currentUser = { user_id: 'c1', user_type: 'client' };
    expect(await run('t1')).toEqual({ permissionError: 'Permission denied: timeline is internal-only in v1' });
    expect(authorizeMock).not.toHaveBeenCalled();
    builders().forEach((b) => expect(b).not.toHaveBeenCalled());
  });

  it('runs ticket:read, then the kernel, then the builder', async () => {
    await run('t1');
    expect(calls).toEqual(['rbac', 'kernel', 'builder']);
  });

  it('does not call the kernel when ticket:read fails', async () => {
    hasPermissionMock.mockResolvedValue(false);
    expect(await run('t1')).toMatchObject({ permissionError: expect.stringMatching(/Permission denied/) });
    expect(authorizeMock).not.toHaveBeenCalled();
    builders().forEach((b) => expect(b).not.toHaveBeenCalled());
  });
});
