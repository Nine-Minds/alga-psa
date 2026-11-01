// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeTicketRecordAccess, createTicketAuthorizationContext } from './ticketRecordAuthorization';

const getVisibilityMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (t: string) => conn(t) }),
}));
vi.mock('./clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityMock(...args),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
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
  beforeEach(() => { getVisibilityMock.mockReset(); });

  it('resolves contact visibility once and passes it to the kernel for client principals', async () => {
    getVisibilityMock.mockResolvedValue(scope({ visibleBoardIds: ['b1'] }));
    const ctx = await createTicketAuthorizationContext(fakeTrx(), 'tenant-1', client);
    expect(getVisibilityMock).toHaveBeenCalledTimes(1);
    expect(ctx.contactVisibility).toMatchObject({ clientId: 'client-1' });
    expect(ctx.selectedBoardIds).toEqual(['b1']);
  });

  it('never uses selected_boards and leaves internal users unnarrowed', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('./ticketRecordAuthorization.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('selected_boards');
    expect(source).not.toContain('resolveClientSelectedBoardIds');
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

  beforeEach(() => { getVisibilityMock.mockReset(); });

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
});
