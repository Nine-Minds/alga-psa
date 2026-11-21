// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuthorizationEvaluationSnapshot } from '@alga-psa/authorization/bundles/service';
import { getEmailLogsForTicket } from './emailLogActions';

let currentUser: any;
let ticketRow: Record<string, unknown> | null;
let emailLogs: Array<Record<string, unknown>>;
let emailQueries: Array<{ selected: string[] }>;
const permissionMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => true));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => permissionMock(...args),
}));

vi.mock('@alga-psa/authorization/bundles/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/authorization/bundles/service')>(),
  loadAuthorizationEvaluationSnapshot: vi.fn(),
}));

const snapshotMock = vi.mocked(loadAuthorizationEvaluationSnapshot);

function makeBuilder(table: string) {
  const state = { selected: [] as string[] };
  const builder: any = new Proxy(function () {}, {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(
          table === 'tickets' ? ticketRow : table === 'email_sending_logs' ? emailLogs : [],
        );
      }
      if (property === 'first') {
        return async () => table === 'tickets' ? ticketRow ?? undefined : undefined;
      }
      if (property === 'select') {
        return (...columns: string[]) => {
          state.selected = columns;
          if (table === 'email_sending_logs') emailQueries.push(state);
          return builder;
        };
      }
      return () => builder;
    },
  });
  return builder;
}

function makeTransaction() {
  return ((table: string) => makeBuilder(table)) as any;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => unknown) => callback(makeTransaction())),
  tenantDb: (conn: (table: string) => unknown) => ({ table: (table: string) => conn(table) }),
}));

const internalReader = {
  user_id: 'reader-1',
  user_type: 'internal',
  tenant: 'tenant-1',
  roles: [{ role_id: 'support-role' }],
};

const ticket = (assignedTo = 'reader-1') => ({
  ticket_id: 'ticket-1',
  assigned_to: assignedTo,
  entered_by: 'creator-2',
  client_id: 'client-1',
  board_id: 'board-1',
  assigned_team_id: null,
  contact_name_id: null,
  billing_profile_id: null,
  attributes: {},
});

const logWithSensitiveFields = {
  id: 45,
  to_addresses: ['first@example.com', 'private-copy@example.com'],
  subject: 'Ticket update',
  status: 'failed',
  error_message: 'Provider rejected message',
  sent_at: new Date('2026-10-01T12:00:00Z'),
  from_address: 'sender@example.com',
  cc_addresses: ['cc@example.com'],
  bcc_addresses: ['bcc@example.com'],
  provider_message_id: 'provider-secret',
  provider_id: 'provider-secret',
  provider_type: 'smtp',
  metadata: { internal: 'sensitive' },
  comment_id: 'comment-secret',
  reply_token_hash: 'hash-secret',
  reply_token_suffix: 'token-secret',
};

describe('getEmailLogsForTicket security', () => {
  beforeEach(() => {
    currentUser = internalReader;
    ticketRow = ticket();
    emailLogs = [logWithSensitiveFields];
    emailQueries = [];
    permissionMock.mockReset().mockResolvedValue(true);
    snapshotMock.mockReset().mockResolvedValue({
      roleIds: ['support-role'],
      teamIds: [],
      managedUserIds: [],
      portfolioClientIds: [],
      rules: [{
        rule_id: 'assigned-ticket-read',
        resource_type: 'ticket',
        action: 'read',
        template_key: 'own_or_assigned',
        constraint_key: null,
        config: {},
      }],
    });
  });

  it('denies a coarse ticket reader narrowed away from the requested ticket before reading correspondence', async () => {
    ticketRow = ticket('someone-else');

    await expect(getEmailLogsForTicket('ticket-1')).rejects.toThrow('Permission denied: Cannot access ticket');
    expect(permissionMock).toHaveBeenCalledWith(internalReader, 'ticket', 'read');
    expect(emailQueries).toHaveLength(0);
  });

  it('returns the ticket UI fields only for an authorized reader', async () => {
    const result = await getEmailLogsForTicket('ticket-1');

    expect(result).toEqual([{
      id: 45,
      recipient: 'first@example.com',
      subject: 'Ticket update',
      status: 'failed',
      error_message: 'Provider rejected message',
      sent_at: logWithSensitiveFields.sent_at,
    }]);
    expect(emailQueries).toHaveLength(1);
    expect(emailQueries[0].selected).toEqual(['id', 'to_addresses', 'subject', 'status', 'error_message', 'sent_at']);
  });

  it('uses the established missing-ticket error without querying email logs', async () => {
    ticketRow = null;

    await expect(getEmailLogsForTicket('missing-ticket')).rejects.toThrow('Ticket not found');
    expect(emailQueries).toHaveLength(0);
  });

  it('does not read correspondence when authorization facts cannot be loaded', async () => {
    snapshotMock.mockRejectedValue(new Error('Authorization context unavailable'));

    await expect(getEmailLogsForTicket('ticket-1')).rejects.toThrow('Authorization context unavailable');
    expect(emailQueries).toHaveLength(0);
  });
});
