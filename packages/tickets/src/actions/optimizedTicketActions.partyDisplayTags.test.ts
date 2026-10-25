import { beforeEach, describe, expect, it, vi } from 'vitest';

// getTicketPartyDisplayTags must authorize the caller's ticket before loading any tags, and refuse
// a contact/client that is not the ticket's own. The authorization kernel is REAL (builtin
// contact_visibility rule); only the DB, the bundle rules and the portal visibility lookup are faked.

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const loadDisplayTagsForEntitiesMock = vi.fn();
let ticketRow: Record<string, unknown> | undefined;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
  registerAfterCommit: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(async () => ({
    effectiveTicketScope: 'client',
    contactId: 'contact-own',
    clientId: 'client-own',
    visibleBoardIds: null,
  })),
}));

vi.mock('@alga-psa/tags/lib/loadDisplayTags', () => ({
  loadDisplayTagsForEntities: (...args: any[]) => loadDisplayTagsForEntitiesMock(...args),
  displayTagKey: (type: string, id: string) => `${type}:${id}`,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../models/ticket', () => ({ default: class Ticket {} }));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ validateData: (_s: unknown, v: unknown) => v }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(),
  publishBuiltWorkflowPayload: vi.fn(),
  publishNonCatalogEventByName: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
}));
vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({ publish: vi.fn() }),
  getRedisClient: vi.fn(),
  getRedisConfig: vi.fn(() => ({ prefix: 'alga-psa:' })),
}));
vi.mock('@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee', () => ({
  assertHumanWorkAssignee: vi.fn(),
  assertHumanWorkOwner: vi.fn(),
}));
vi.mock('@alga-psa/shared/lib/tickets/ticketLifecycleEvents', () => ({
  publishTicketTransitionsAfterCommit: vi.fn(),
  captureTicketTransitionSnapshot: vi.fn(),
}));
vi.mock('@alga-psa/shared/models/ticketModel', () => ({ TicketModel: {} }));
vi.mock('../lib/workflowTicketTransitionEvents', () => ({ buildTicketTransitionWorkflowEvents: vi.fn(() => []) }));
vi.mock('../lib/workflowTicketCommunicationEvents', () => ({ buildTicketCommunicationWorkflowEvents: vi.fn(() => []) }));
vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(() => null),
  publishWorkflowTicketSlaStageEvent: vi.fn(),
}));
vi.mock('../lib/validateTicketClosure', () => ({ enforceTicketCloseRules: vi.fn() }));
vi.mock('./ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
  previewBundleStatusPropagation: vi.fn(),
  propagateBundleMasterStatus: vi.fn(),
  mirrorCommentToChild: vi.fn(),
}));

import { getTicketPartyDisplayTags } from './optimizedTicketActions';

const TICKET_ID = 'ticket-1';
const OWN_CLIENT = 'client-own';
const OWN_CONTACT = 'contact-own';

function buildTrx() {
  const emptyRows: any = {
    where: () => emptyRows,
    select: () => emptyRows,
    catch: () => Promise.resolve([]),
    then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
  };
  const ticketBuilder: any = {
    where: vi.fn(() => ticketBuilder),
    select: vi.fn(() => ticketBuilder),
    first: vi.fn(async () => ticketRow),
  };
  const trx: any = (table: string) => (table === 'tickets as t' ? ticketBuilder : emptyRows);
  trx.ticketBuilder = ticketBuilder;
  return trx;
}

function chipsFor(type: string, id: string) {
  return [{ tag_id: `${type}-tag`, tag_text: `${type}:${id}` }];
}

describe('getTicketPartyDisplayTags authorization', () => {
  let trx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    trx = buildTrx();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => unknown) => cb(trx));
    hasPermissionMock.mockResolvedValue(true);
    ticketRow = {
      ticket_id: TICKET_ID,
      entered_by: 'someone',
      assigned_to: null,
      client_id: OWN_CLIENT,
      board_id: 'board-1',
      contact_name_id: OWN_CONTACT,
      billing_profile_id: null,
      attributes: {},
      assigned_team_id: null,
    };
    loadDisplayTagsForEntitiesMock.mockImplementation(async (_t, _tenant, _aud, groups: any[]) => {
      const map = new Map<string, unknown>();
      for (const g of groups) for (const id of g.ids) if (id) map.set(`${g.taggedType}:${id}`, chipsFor(g.taggedType, id));
      return map;
    });
    currentUser = { user_id: 'u-portal', tenant: 'tenant-1', user_type: 'client', clientId: OWN_CLIENT, contact_id: OWN_CONTACT };
  });

  const expectPermissionDenied = (result: any) => {
    expect(result).toBeTruthy();
    expect(result).not.toHaveProperty('contact');
    expect(result).toMatchObject({ permissionError: expect.stringMatching(/^Permission denied:/) });
    expect(loadDisplayTagsForEntitiesMock).not.toHaveBeenCalled();
  };

  it('a1: refuses another client id on the portal user\'s own ticket', async () => {
    expectPermissionDenied(await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, 'client-other'));
  });

  it('a2: refuses an unrelated contact id on the portal user\'s own ticket', async () => {
    expectPermissionDenied(await getTicketPartyDisplayTags(TICKET_ID, 'contact-other', OWN_CLIENT));
  });

  it('a3: refuses a ticket belonging to another client', async () => {
    ticketRow = { ...ticketRow, client_id: 'client-other', contact_name_id: 'contact-other' };
    expectPermissionDenied(await getTicketPartyDisplayTags(TICKET_ID, 'contact-other', 'client-other'));
  });

  it('a3b: refuses a missing ticket with the same permission error', async () => {
    ticketRow = undefined;
    expectPermissionDenied(await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, OWN_CLIENT));
  });

  it('a4: refuses an MSP user without ticket:read before touching the ticket', async () => {
    currentUser = { user_id: 'u-msp', tenant: 'tenant-1', user_type: 'internal' };
    hasPermissionMock.mockResolvedValue(false);
    expectPermissionDenied(await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, OWN_CLIENT));
    expect(trx.ticketBuilder.first).not.toHaveBeenCalled();
  });

  it('b: returns chips for the ticket\'s own requester and client (portal user)', async () => {
    const result = await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, OWN_CLIENT);
    expect(result).toEqual({
      contact: chipsFor('contact', OWN_CONTACT),
      client: chipsFor('client', OWN_CLIENT),
    });
    expect(loadDisplayTagsForEntitiesMock).toHaveBeenCalledWith(
      trx,
      'tenant-1',
      expect.anything(),
      [
        { taggedType: 'contact', ids: [OWN_CONTACT] },
        { taggedType: 'client', ids: [OWN_CLIENT] },
      ]
    );
  });

  it('b: returns chips for the ticket\'s own requester and client (MSP user)', async () => {
    currentUser = { user_id: 'u-msp', tenant: 'tenant-1', user_type: 'internal' };
    const result = await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, OWN_CLIENT);
    expect(result).toEqual({
      contact: chipsFor('contact', OWN_CONTACT),
      client: chipsFor('client', OWN_CLIENT),
    });
    expect(loadDisplayTagsForEntitiesMock.mock.calls[0][3]).toEqual([
      { taggedType: 'contact', ids: [OWN_CONTACT] },
      { taggedType: 'client', ids: [OWN_CLIENT] },
    ]);
  });

  it('c: a null contact on an authorized ticket returns no contact chips plus the client chips', async () => {
    ticketRow = { ...ticketRow, contact_name_id: null };
    const result = await getTicketPartyDisplayTags(TICKET_ID, null, OWN_CLIENT);
    expect(result).toEqual({ contact: [], client: chipsFor('client', OWN_CLIENT) });
  });

  it('passes the full authorization record (including billing_profile_id) to the kernel', async () => {
    await getTicketPartyDisplayTags(TICKET_ID, OWN_CONTACT, OWN_CLIENT);
    expect(trx.ticketBuilder.select).toHaveBeenCalledWith(
      't.ticket_id', 't.entered_by', 't.assigned_to', 't.client_id', 't.board_id',
      't.contact_name_id', 't.billing_profile_id', 't.attributes', 't.assigned_team_id'
    );
  });
});
