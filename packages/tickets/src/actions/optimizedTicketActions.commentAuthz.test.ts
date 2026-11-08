// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTicketCommentInTransaction, addTicketCommentWithCache } from './optimizedTicketActions';
import { bulkUpdateTicketStatus } from './ticketActions';
import { persistCommentPublication } from '@alga-psa/shared/lib/ticketCommentAttachments';

// Real authorization kernel + real ticketRecordAuthorization; only the DB and the
// contact-visibility resolver are faked.

let currentUser: any;
let ticketRow: Record<string, unknown> | null;
let visibilityByContact: Record<string, any>;
let inserts: Array<{ table: string; row: any }>;
let updates: Array<{ table: string; patch: any }>;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const registerAfterCommitMock = vi.fn();
const resolveBundleRulesMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
  localizeActionError: async (result: unknown) => result,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn() }));

/** Permissive chainable query builder: awaiting yields [], `.first()` yields the table's row. */
function makeBuilder(table: string) {
  const builder: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: any) => resolve([]);
      }
      if (prop === 'first') {
        return async () => {
          if (table === 'tickets') return ticketRow ?? undefined;
          if (table === 'statuses') return { status_id: 'status-closed', is_closed: true };
          return undefined;
        };
      }
      if (prop === 'update') {
        return (patch: any) => {
          updates.push({ table, patch });
          return builder;
        };
      }
      if (prop === 'insert') {
        return (row: any) => {
          inserts.push({ table, row });
          const result: any = Promise.resolve([row]);
          result.returning = async () => [{ ...row }];
          return result;
        };
      }
      return () => builder;
    },
  });
  return builder;
}
function makeTrx() {
  const trx: any = (table: string) => makeBuilder(table);
  trx.raw = async () => ({ rows: [{ comment_id: 'comment-new', thread_id: 'thread-new' }] });
  trx.isTransaction = true;
  trx.fn = { now: () => new Date() };
  return trx;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  registerAfterCommit: (...args: any[]) => registerAfterCommitMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    subquery: (table: string) => conn(table),
    tenantJoin: (query: any) => query,
    unscoped: (table: string) => conn(table),
    scoped: (table: string) => ({ builder: conn(table) }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../models/ticket', () => ({ default: class Ticket {} }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ validateData: (_s: unknown, v: unknown) => v }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus', () => ({ getEventBus: () => ({ publish: vi.fn() }) }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn(async () => 'markdown'),
}));
vi.mock('../lib/cannedResponses/commentMerge', () => ({
  resolveCommentMergeTokens: vi.fn(async (_trx, _tenant, _id, _uid, _type, content: string) => content),
}));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  reconcileCommentAttachments: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({
  persistCommentPublication: vi.fn(async () => undefined),
  reconcileCommentAttachments: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: async (_trx: unknown, _tenant: string, contactId: string) => {
    const ctx = visibilityByContact[contactId];
    if (!ctx) throw new Error('visibility unresolved');
    return ctx;
  },
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => resolveBundleRulesMock(...args),
  authorizationEvaluationSnapshotQuery: vi.fn(() => ({ as: () => null })),
  loadAuthorizationEvaluationSnapshot: vi.fn(async (_trx: any, input: any) => ({
    roleIds: [], teamIds: [], managedUserIds: [], rules: (await resolveBundleRulesMock(input)).map((rule: any) => ({
      rule_id: rule.id, resource_type: rule.resource, action: rule.action, template_key: rule.templateKey,
      constraint_key: rule.constraintKey ?? null, config: { selectedBoardIds: rule.selectedBoardIds },
    })),
  })),
  bundleNarrowingRuleFromRow: (rule: any) => ({
    id: rule.rule_id, resource: rule.resource_type, action: rule.action, templateKey: rule.template_key,
    constraintKey: rule.constraint_key ?? null, constraints: rule.config?.constraints ?? [],
    selectedBoardIds: rule.config?.selectedBoardIds ?? [],
  }),
}));

const CONTENT = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]);

function clientUser(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'client-user-1',
    user_type: 'client',
    tenant: 'tenant-1',
    contact_id: 'contact-1',
    clientId: 'client-1',
    roles: [{ role_id: 'role-client' }],
    ...overrides,
  };
}
const internalUser = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-1', roles: [{ role_id: 'r' }] };

function visibility(overrides: Record<string, unknown> = {}) {
  return {
    effectiveTicketScope: 'contact',
    ticketScope: 'contact',
    contactId: 'contact-1',
    clientId: 'client-1',
    visibleBoardIds: ['board-1'],
    grantedTicketProfileIds: [],
    isClientAdmin: false,
    visibilityGroupId: 'group-1',
    ...overrides,
  };
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    tenant: 'tenant-1',
    client_id: 'client-1',
    board_id: 'board-1',
    contact_name_id: 'contact-1',
    billing_profile_id: null,
    attributes: {},
    assigned_to: null,
    entered_by: 'someone',
    assigned_team_id: null,
    ...overrides,
  };
}

const input = (extra: Record<string, unknown> = {}) => ({
  ticketId: 'ticket-1',
  content: CONTENT,
  isInternal: false,
  isResolution: false,
  ...extra,
});

const writtenTables = () => inserts.map((i) => i.table);

describe('addTicketCommentInTransaction record-level authorization', () => {
  beforeEach(() => {
    inserts = [];
    updates = [];
    registerAfterCommitMock.mockClear();
    vi.mocked(persistCommentPublication).mockClear();
    resolveBundleRulesMock.mockReset().mockResolvedValue([]);
    ticketRow = ticket();
    visibilityByContact = { 'contact-1': visibility() };
    currentUser = clientUser();
    hasPermissionMock.mockReset().mockResolvedValue(true);
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: makeTrx(), tenant: 'tenant-1' });
    withTransactionMock.mockReset().mockImplementation(async (_knex: any, cb: any) => cb(makeTrx()));
  });

  it('rejects a client commenting on another client\'s ticket in the same tenant, with no writes', async () => {
    ticketRow = ticket({ client_id: 'client-2' });
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
    expect(writtenTables()).toEqual([]);
  });

  it.each([
    ['board', { board_id: 'board-9' }],
    ['contact', { contact_name_id: 'contact-9' }],
  ])('rejects a same-client ticket outside the contact visibility (%s)', async (_label, override) => {
    ticketRow = ticket(override);
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
    expect(writtenTables()).toEqual([]);
  });

  it('rejects when the billing profile is not granted and the contact is not the ticket contact', async () => {
    visibilityByContact = { 'contact-1': visibility({ grantedTicketProfileIds: ['profile-ok'] }) };
    ticketRow = ticket({ contact_name_id: 'contact-9', billing_profile_id: 'profile-other' });
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
    expect(writtenTables()).toEqual([]);
  });

  it('rejects a client whose visibility cannot be resolved (fail closed)', async () => {
    visibilityByContact = {};
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
    expect(writtenTables()).toEqual([]);
  });

  it('rejects a client with no linked contact', async () => {
    currentUser = clientUser({ contact_id: undefined });
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
    expect(writtenTables()).toEqual([]);
  });

  it('reports a missing ticket as not found to internal users (404 mapping)', async () => {
    ticketRow = null;
    await expect(
      addTicketCommentInTransaction(makeTrx(), internalUser as any, 'tenant-1', input()),
    ).rejects.toThrow('Ticket not found');
  });

  it('does not reveal a missing ticket to a client: same denial as a foreign ticket', async () => {
    ticketRow = null;
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input()),
    ).rejects.toThrow(/Permission denied/);
  });

  it('allows a client to comment on a ticket visible to them', async () => {
    const comment = await addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input());
    expect(comment).toBeTruthy();
    expect(writtenTables()).toContain('comment_threads');
    expect(writtenTables()).toContain('comments');
  });

  it('allows a client-scope contact to comment on any ticket of their client on a visible board', async () => {
    visibilityByContact = { 'contact-1': visibility({ effectiveTicketScope: 'client', ticketScope: 'client' }) };
    ticketRow = ticket({ contact_name_id: 'contact-9' });
    await addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input());
    expect(writtenTables()).toContain('comments');
  });

  it('does not affect an internal (MSP) user', async () => {
    ticketRow = ticket({ client_id: 'client-2', board_id: 'board-9' });
    await addTicketCommentInTransaction(makeTrx(), internalUser as any, 'tenant-1', input({ isInternal: true }));
    expect(writtenTables()).toContain('comments');
  });

  it('keeps the client constraints (no internal notes, no scheduling)', async () => {
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input({ isInternal: true })),
    ).rejects.toThrow('Only MSP users can create internal comments');
    await expect(
      addTicketCommentInTransaction(makeTrx(), currentUser, 'tenant-1', input({
        schedule: { publishAt: new Date(Date.now() + 3_600_000).toISOString(), timeZone: 'UTC' },
      })),
    ).rejects.toThrow(/schedule/);
    expect(writtenTables()).toEqual([]);
  });

  it('gates addTicketCommentWithCache through the same helper (returns an error, writes nothing)', async () => {
    ticketRow = ticket({ client_id: 'client-2' });
    const result: any = await addTicketCommentWithCache('ticket-1', CONTENT, false, false);
    expect(result?.permissionError ?? result?.actionError).toBeTruthy();
    expect(result?.comment_id).toBeUndefined();
    expect(writtenTables()).toEqual([]);
  });

  it('denies a bulk resolution outside the MSP user\'s board grant before any write or event', async () => {
    currentUser = internalUser;
    ticketRow = ticket({ response_state: 'awaiting_internal' });
    resolveBundleRulesMock.mockResolvedValue([{
      id: 'board-grant',
      resource: 'ticket',
      action: 'update',
      templateKey: 'selected_boards',
      selectedBoardIds: ['board-other'],
    }]);

    const result = await bulkUpdateTicketStatus(['ticket-1'], 'status-closed', {
      resolutionComment: { text: 'Resolved.', isInternal: false },
    });

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(resolveBundleRulesMock).toHaveBeenCalled();
    expect(result.updatedIds).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({
      ticketId: 'ticket-1',
      message: 'Permission denied: Cannot access ticket',
    })]);
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
    expect(persistCommentPublication).not.toHaveBeenCalled();
    expect(registerAfterCommitMock).not.toHaveBeenCalled();
  });
});
