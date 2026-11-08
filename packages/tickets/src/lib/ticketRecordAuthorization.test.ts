// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeTicketRecordAccess,
  authorizeTicketRecordAccessConcealed,
  createTicketAuthorizationContext,
} from './ticketRecordAuthorization';

const getVisibilityMock = vi.fn<(...args: any[]) => Promise<any>>();
const hasPermissionMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<boolean>>(async () => true));
const resolveBundleRulesMock = vi.hoisted(() => vi.fn<typeof import('@alga-psa/authorization/bundles/service').resolveBundleNarrowingRulesForEvaluation>(async () => []));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (t: string) => conn(t) }),
}));
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: (...args: any[]) => hasPermissionMock(...args) }));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityMock(...args),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: resolveBundleRulesMock,
}));

function fakeTrx(ticket: Record<string, unknown> | null = null) {
  const make = (table: string): any =>
    new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: any) => resolve([]);
        if (prop === 'first') return async () => (table === 'tickets' ? ticket ?? undefined : undefined);
        return () => make(table);
      },
    });
  return ((table: string) => make(table)) as any;
}

const scope = (o: Record<string, unknown> = {}) => ({
  effectiveTicketScope: 'client',
  ticketScope: 'client',
  contactId: 'contact-1',
  clientId: 'client-1',
  visibleBoardIds: null,
  isClientAdmin: false,
  visibilityGroupId: null,
  ...o,
});
const client = { user_id: 'u1', user_type: 'client', contact_id: 'contact-1', clientId: 'client-1', roles: [{ role_id: 'r' }] } as any;

describe('createTicketAuthorizationContext', () => {
  beforeEach(() => {
    getVisibilityMock.mockReset();
    hasPermissionMock.mockReset().mockResolvedValue(true);
    resolveBundleRulesMock.mockReset().mockResolvedValue([]);
  });

  it('resolves contact visibility once and passes it to the kernel for client principals', async () => {
    getVisibilityMock.mockResolvedValue(scope({ visibleBoardIds: ['b1'] }));
    const ctx = await createTicketAuthorizationContext(fakeTrx(), 'tenant-1', client);
    expect(getVisibilityMock).toHaveBeenCalledTimes(1);
    expect(ctx.contactVisibility).toMatchObject({ clientId: 'client-1' });
    expect(ctx.selectedBoardIds).toEqual(['b1']);
  });

  it('leaves internal users without client portal narrowing', async () => {
    const ctx = await createTicketAuthorizationContext(fakeTrx(), 'tenant-1', { user_id: 'i', user_type: 'internal', roles: [] } as any);
    expect(ctx.contactVisibility).toBeUndefined();
    expect(ctx.selectedBoardIds).toBeUndefined();
    expect(getVisibilityMock).not.toHaveBeenCalled();
  });

  it('denies a client with no contact, and a client whose resolution fails', async () => {
    const noContact = await createTicketAuthorizationContext(fakeTrx(), 'tenant-1', { ...client, contact_id: undefined });
    expect(noContact.contactVisibility).toBeNull();
    getVisibilityMock.mockImplementation(() => { throw new Error('boom'); });
    const failed = await createTicketAuthorizationContext(fakeTrx(), 'tenant-1', client);
    expect(failed.contactVisibility).toBeNull();
  });
});

describe('authorizeTicketRecordAccess (client principals)', () => {
  const row = (o: Record<string, unknown> = {}) => ({
    ticket_id: 't1', client_id: 'client-1', board_id: 'b1', contact_name_id: 'contact-1',
    billing_profile_id: null, attributes: {}, assigned_to: null, entered_by: null, assigned_team_id: null, ...o,
  });
  const run = (ticket: any, user: any = client) =>
    authorizeTicketRecordAccess({ trx: fakeTrx(ticket), tenant: 'tenant-1', user, ticketId: 't1', action: 'update' });

  beforeEach(() => {
    getVisibilityMock.mockReset();
    hasPermissionMock.mockReset().mockResolvedValue(true);
    resolveBundleRulesMock.mockReset().mockResolvedValue([]);
  });

  it('allows a visible ticket', async () => {
    getVisibilityMock.mockResolvedValue(scope({ visibleBoardIds: ['b1'] }));
    await expect(run(row())).resolves.toMatchObject({ ticket_id: 't1' });
  });

  it('denies another client\'s ticket, a hidden board, and a hidden contact', async () => {
    getVisibilityMock.mockResolvedValue(scope({ effectiveTicketScope: 'contact', ticketScope: 'contact', visibleBoardIds: ['b1'] }));
    await expect(run(row({ client_id: 'client-2' }))).rejects.toThrow(/Permission denied/);
    await expect(run(row({ board_id: 'b9' }))).rejects.toThrow(/Permission denied/);
    await expect(run(row({ contact_name_id: 'contact-9' }))).rejects.toThrow(/Permission denied/);
  });

  it('denies a client with no contact', async () => {
    await expect(run(row(), { ...client, contact_id: undefined })).rejects.toThrow(/Permission denied/);
  });

  it('reports a missing ticket as not found', async () => {
    await expect(run(null)).rejects.toThrow('Ticket not found');
  });

  it('requires coarse ticket delete permission after record authorization', async () => {
    getVisibilityMock.mockResolvedValue(scope({ visibleBoardIds: ['b1'] }));
    hasPermissionMock.mockResolvedValueOnce(false);
    await expect(authorizeTicketRecordAccess({
      trx: fakeTrx(row()), tenant: 'tenant-1', user: client, ticketId: 't1', action: 'delete',
    })).rejects.toThrow('Permission denied: Cannot delete ticket');
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ ...client, tenant: 'tenant-1' }),
      'ticket',
      'delete',
      expect.anything(),
    );
  });

  it('fails closed when bundle policy resolution fails during deletion', async () => {
    const internal = { user_id: 'internal-1', user_type: 'internal', roles: [{ role_id: 'r1' }] } as any;
    const trx = fakeTrx(row());
    resolveBundleRulesMock.mockRejectedValueOnce(new Error('bundle policy database unavailable'));

    await expect(authorizeTicketRecordAccess({
      trx, tenant: 'tenant-1', user: internal, ticketId: 't1', action: 'delete',
    })).rejects.toThrow('bundle policy database unavailable');
    expect(resolveBundleRulesMock).toHaveBeenCalledExactlyOnceWith(trx, expect.objectContaining({
      subject: expect.objectContaining({ tenant: 'tenant-1', userId: 'internal-1' }),
      resource: { type: 'ticket', action: 'delete', id: 't1' },
    }));
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('conceals a retained UUID after client visibility is lost, matching a missing ticket', async () => {
    getVisibilityMock.mockResolvedValue(scope({ effectiveTicketScope: 'contact', ticketScope: 'contact' }));
    const request = (ticket: any) => authorizeTicketRecordAccessConcealed({
      trx: fakeTrx(ticket), tenant: 'tenant-1', user: client, ticketId: 't1', action: 'delete',
    });
    const missing = await request(null).catch((error) => error.message);
    const invisible = await request(row({ contact_name_id: 'different-contact' })).catch((error) => error.message);

    expect(missing).toBe('Permission denied: Cannot access ticket');
    expect(invisible).toBe('Permission denied: Cannot access ticket');
  });
});

describe('authorizeTicketRecordAccessConcealed conceal option', () => {
  const internal = { user_id: 'i1', user_type: 'internal', roles: [{ role_id: 'r' }] } as any;
  const row = { ticket_id: 't1', client_id: 'c', board_id: 'b', assigned_to: null, entered_by: null, assigned_team_id: null };

  const run = (user: any, ticket: any, extra: Record<string, unknown> = {}) =>
    authorizeTicketRecordAccessConcealed({ trx: fakeTrx(ticket), tenant: 'tenant-1', user, ticketId: 't1', action: 'read', ...extra });

  // Internal users are only denied by a bundle rule; simulate via the bundle service.
  const denyAll = async () => {
    resolveBundleRulesMock.mockResolvedValue([
      { id: 'rule-1', resource: 'ticket', action: 'read', templateKey: 'selected_boards', selectedBoardIds: ['other-board'] },
    ]);
  };

  beforeEach(() => {
    getVisibilityMock.mockReset();
    resolveBundleRulesMock.mockReset().mockResolvedValue([]);
  });

  it('default and "client" keep the kernel denial message for internal users', async () => {
    await denyAll();
    await expect(run(internal, row)).rejects.toThrow('Permission denied: Cannot access ticket');
    await expect(run(internal, row, { conceal: 'client' })).rejects.toThrow('Permission denied: Cannot access ticket');
  });

  it('"all" maps an internal kernel denial to Ticket not found', async () => {
    await denyAll();
    await expect(run(internal, row, { conceal: 'all' })).rejects.toThrow('Ticket not found');
  });

  it('"all" still reports a missing ticket as Ticket not found for internal users', async () => {
    await expect(run(internal, null, { conceal: 'all' })).rejects.toThrow('Ticket not found');
  });

  it('"all" keeps client principals on Permission denied', async () => {
    getVisibilityMock.mockResolvedValue(scope());
    await expect(run(client, null, { conceal: 'all' })).rejects.toThrow('Permission denied: Cannot access ticket');
    await expect(run(client, null)).rejects.toThrow('Permission denied: Cannot access ticket');
  });

  it('"all" passes unrelated errors through unchanged', async () => {
    const trx = (() => { throw new Error('db exploded'); }) as any;
    await expect(
      authorizeTicketRecordAccessConcealed({ trx, tenant: 'tenant-1', user: internal, ticketId: 't1', action: 'read', conceal: 'all' }),
    ).rejects.toThrow('db exploded');
  });
});
