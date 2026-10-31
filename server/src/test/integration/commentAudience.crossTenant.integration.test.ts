/**
 * CM L4a: conversation audiences across two tenants, end to end on the real schema.
 *
 * A sponsor MSP tenant (psa) owns a ticket shared with a customer co_managed workspace.
 * One comment of every audience is seeded:
 *   (a) requester        -- createSharedTicketComment
 *   (b) shared_it        -- createSharedTicketComment
 *   (c) MSP private note -- native Comment.insert (legacy NULL audience, internal)
 *   (d) customer private -- mutateCoManagedPrivateTicketComment (author's tenant store)
 * and each persona's read is asserted: MSP tech (native read), Alice (customer IT, shared
 * conversation read) and the portal requester (getClientTicketDetails). Search (indexer and
 * ACL verifier) and the published TICKET_COMMENT_ADDED payload must never reach the requester
 * with a non-requester audience, and the customer's private body must exist in no row of any
 * sponsor-tenant table. Native tenants (Kansas: flag off, Emerald: flag on, no entitlement)
 * keep NULL audiences and unchanged visibility.
 *
 * Only these stand-ins are used: the shared-work admission wrappers, session expiry, lifecycle
 * admission, private-participation evidence retention, transport (event bus, live updates) and
 * the portal session/permission seam. Comment writers, threads, receipts, private stores,
 * readers, search SQL and publication intent are all real rows and code.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

let currentUser: any;
let testDb: Knex;

const admit = async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('../../../../packages/co-managed/src/privateParticipationEvidence', () => ({ retainCoManagedPrivateParticipation: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({ getUserAvatarUrlAction: async () => null, getContactAvatarUrlAction: async () => null }));
vi.mock('../../../../packages/client-portal/src/lib/portalTicketExternalLinks', () => ({ loadPortalTicketExternalLinks: async () => [] }));
// The portal session and RBAC seam only; every query below it is real.
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<any>()),
  getConnection: async () => testDb,
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? currentUser?.tenant }),
}));

interface World { tenant: string; clientId: string; contactId: string; portalUserId: string; techId: string; ticketId: string }
interface Persona { actor: any; resource: any }

let db: Knex;
const tenants: string[] = [];
const ids = { requester: uuidv4(), sharedIt: uuidv4(), mspPrivate: '', customerPrivate: '' };
let msp: World, customer: string, aliceId: string, relationshipId: string;
let alice: Persona, mspTech: Persona;
const MARK = uuidv4().slice(0, 8);
const body = { requester: `REQ-${MARK}`, sharedIt: `SHAREDIT-${MARK}`, mspPrivate: `MSPNOTE-${MARK}`, customerPrivate: `CUSTPRIVATE-${MARK}` };
let replyId: string, damagedId: string, childId: string;

async function seedWorld(name: string, productCode: 'psa' | 'co_managed' = 'psa'): Promise<World> {
  const tenant = await createTenant(db, name, { productCode });
  tenants.push(tenant);
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), ticketId = uuidv4(), contactId = uuidv4();
  const techId = await createUser(db, tenant, { first_name: 'Morgan', last_name: 'Tech' });
  const t = (table: string) => db(table);
  await t('clients').insert({ tenant, client_id: clientId, client_name: `${name} Client`, billing_cycle: 'monthly', is_tax_exempt: false });
  await t('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Rita Requester', email: `rita-${contactId}@example.com`, client_id: clientId });
  const portalUserId = await createUser(db, tenant, { user_type: 'client', contact_id: contactId, first_name: 'Rita', last_name: 'Requester' });
  await t('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await t('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: techId });
  await t('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: techId });
  await t('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, title: `${name} ticket`, client_id: clientId,
    contact_name_id: contactId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: techId });
  return { tenant, clientId, contactId, portalUserId, techId, ticketId };
}

const createShared = async (p: Persona, request: any) => (await import('../../lib/co-managed/createTicketComment')).createSharedTicketComment(db, p.actor, p.resource, request);
const mutatePrivate = async (p: Persona, command: any) => (await import('../../../../packages/co-managed/src/privateTicketConversation')).mutateCoManagedPrivateTicketComment(db, p.actor, p.resource, command);
const aliceConversation = async () => (await import('../../../../packages/co-managed/src/ticketConversation')).getCoManagedTicketConversation(db, alice.actor, alice.resource);
const portalAs = (w: World) => { currentUser = { user_id: w.portalUserId, user_type: 'client', tenant: w.tenant, email: 'rita@example.com' }; };
const portalConversations = async (w: World) => {
  portalAs(w);
  const result: any = await (await import('../../../../packages/client-portal/src/actions/client-portal-actions/client-tickets')).getClientTicketDetails(w.ticketId);
  expect(result.conversations, JSON.stringify(result)).toBeDefined();
  return result.conversations as any[];
};
const commentIds = (rows: any[]) => rows.map(r => r.comment_id ?? r.commentId ?? r.objectId ?? r.id).sort();
const sorted = (...v: string[]) => [...v].sort();

/** Every text/json column of every tenant-keyed table, scanned for a marker within one tenant. */
async function tablesContaining(tenant: string, marker: string): Promise<string[]> {
  const { rows } = await db.raw(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.table_name AND k.column_name = 'tenant')`);
  const byTable = new Map<string, string[]>();
  for (const row of rows) byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
  const hits: string[] = [];
  for (const [table, columns] of byTable) {
    const predicate = columns.map(() => '?? ::text ILIKE ?').join(' OR ');
    const bindings = columns.flatMap(column => [column, `%${marker}%`]);
    const { rows: found } = await db.raw(`SELECT 1 FROM ?? WHERE tenant = ? AND (${predicate}) LIMIT 1`, [table, tenant, ...bindings]);
    if (found.length) hits.push(table);
  }
  return hits;
}

function resetAdmission(coManaged: boolean) {
  (globalThis as any).__algaWriteAdmissionState = undefined;
  (globalThis as any).__algaWriteAdmissionResolver = coManaged ? async () => ({ canWrite: true }) : undefined;
}

beforeAll(async () => {
  db = await createTestDbConnection();
  testDb = db;
  resetAdmission(false);
  msp = await seedWorld('Sponsor MSP');
  customer = await createTenant(db, 'Customer Workspace', { productCode: 'co_managed' });
  tenants.push(customer);
  aliceId = await createUser(db, customer, { first_name: 'Alice', last_name: 'CustomerIT' });
  relationshipId = uuidv4();
  await db('co_management_relationships').insert({ tenant: msp.tenant, relationship_id: relationshipId, sponsor_tenant: customer, sponsor_client_id: msp.clientId });
  const resource = { kind: 'ticket', tenant: msp.tenant, relationshipId, id: msp.ticketId };
  mspTech = { actor: { kind: 'session', tenant: msp.tenant, userId: msp.techId, sessionId: uuidv4() }, resource };
  alice = { actor: { kind: 'session', tenant: customer, userId: aliceId, sessionId: uuidv4() }, resource };

  // (a) requester and (b) shared_it, through the shared command
  await createShared(mspTech, { operationId: ids.requester, audience: 'requester', text: body.requester });
  await createShared(mspTech, { operationId: ids.sharedIt, audience: 'shared_it', text: body.sharedIt });
  // replies under (b): a normal one, and one whose parent is later damaged so it must be masked
  const parent = { storeTenant: msp.tenant, threadId: ids.sharedIt, commentId: ids.sharedIt };
  replyId = uuidv4(); damagedId = uuidv4(); childId = uuidv4();
  await createShared(mspTech, { operationId: replyId, parent, text: `visible-reply-${MARK}` });
  await createShared(mspTech, { operationId: damagedId, parent, text: `damaged-${MARK}` });
  await createShared(mspTech, { operationId: childId, parent: { ...parent, commentId: damagedId }, text: `masked-child-${MARK}` });
  await db('comments').where({ tenant: msp.tenant, comment_id: damagedId }).update({ is_internal: false });
  // (c) MSP private note through the native insert path
  const { default: Comment } = await import('../../../../packages/tickets/src/models/comment');
  ids.mspPrivate = await Comment.insert(db, msp.tenant, { ticket_id: msp.ticketId, user_id: msp.techId, author_type: 'internal', is_internal: true,
    note: body.mspPrivate, markdown_content: body.mspPrivate, is_resolution: false } as any);
  // (d) customer-side private note, written to the customer's own store
  const created = await mutatePrivate(alice, { kind: 'create', operationId: uuidv4(), text: body.customerPrivate });
  ids.customerPrivate = created.commentId;
}, 120_000);

afterAll(async () => {
  if (db) {
    try {
      // No superuser here, so delete in dependency order by retrying FK-blocked tables until none remain.
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) {
          try { await db.raw('DELETE FROM ?? WHERE tenant = ANY(?::uuid[])', [table, tenants]); } catch { blocked.push(table); }
        }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
      if (pending.length) process.stderr.write(`cross-tenant audience cleanup left tables: ${pending.join(', ')}\n`);
    } catch (error) {
      process.stderr.write(`cross-tenant audience cleanup skipped: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    resetAdmission(false);
    await db.destroy();
  }
});

afterEach(() => { vi.clearAllMocks(); });

describe('cross-tenant conversation audiences', () => {
  it('stores each audience where it belongs', async () => {
    const audienceOf = async (id: string) => (await db('comments as c').join('comment_threads as t', function () { this.on('t.thread_id', 'c.thread_id').andOn('t.tenant', 'c.tenant'); })
      .where({ 'c.tenant': msp.tenant, 'c.comment_id': id }).first('t.collaboration_audience', 't.is_internal'));
    expect(await audienceOf(ids.requester)).toMatchObject({ collaboration_audience: 'requester', is_internal: false });
    expect(await audienceOf(ids.sharedIt)).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
    expect(await audienceOf(ids.mspPrivate)).toMatchObject({ collaboration_audience: null, is_internal: true });
    expect(await db('comments').where({ tenant: msp.tenant, comment_id: ids.customerPrivate })).toHaveLength(0);
    expect(await db('co_management_private_comments').where({ tenant: customer, comment_id: ids.customerPrivate })).toHaveLength(1);
    expect(await db('co_management_private_comments').where({ tenant: msp.tenant })).toHaveLength(0);
  });

  it('MSP tech (native ticket read): requester, shared_it and the own private note; never the customer private body', async () => {
    const { findCommentsByTicketId } = await import('../../../../packages/tickets/src/actions/comment-actions/commentActions');
    currentUser = { user_id: msp.techId, user_type: 'internal', tenant: msp.tenant };
    const comments: any = await findCommentsByTicketId(msp.ticketId);
    const seen = commentIds(comments);
    for (const id of [ids.requester, ids.sharedIt, ids.mspPrivate]) expect(seen).toContain(id);
    expect(seen).not.toContain(ids.customerPrivate);
    expect(JSON.stringify(comments)).not.toContain(body.customerPrivate);
  });

  it('Alice (customer IT): requester, shared_it and her own private note; never the MSP note; parents masked', async () => {
    const conversation = await aliceConversation();
    const byId = new Map(conversation.items.map(item => [item.commentId, item]));
    for (const id of [ids.requester, ids.sharedIt, ids.customerPrivate, replyId, childId]) expect(byId.has(id), id).toBe(true);
    expect(byId.has(ids.mspPrivate)).toBe(false);
    expect(byId.has(damagedId)).toBe(false);
    expect(byId.get(ids.requester)!.audience).toBe('requester');
    expect(byId.get(ids.sharedIt)!.audience).toBe('shared_it');
    expect(byId.get(ids.customerPrivate)).toMatchObject({ audience: 'organization_private', storeTenant: customer });
    const text = JSON.stringify(conversation);
    expect(text).not.toContain(body.mspPrivate);
    expect(text).toContain(body.customerPrivate);
    // a reply under a visible parent keeps it; a reply under a masked parent points at nothing
    expect(byId.get(replyId)!.parentCommentId).toBe(ids.sharedIt);
    expect(byId.get(childId)!.parentCommentId).toBeNull();
    // the same reader through the screen action's adapter sees the same set
    const { loadSharedConversation } = await import('../../lib/co-managed/loadSharedConversation');
    const snapshot = await loadSharedConversation(async before => ({ ...(await (await import('../../../../packages/co-managed/src/ticketConversation')).getCoManagedTicketConversation(db, alice.actor, alice.resource, before)),
      actor: { tenant: customer, userId: aliceId }, writeAudiences: ['requester', 'shared_it', 'organization_private'] }));
    expect(snapshot.items.map(i => i.commentId).sort()).toEqual([...byId.keys()].sort());
  });

  it('requester (portal read): the requester comment only', async () => {
    const conversations = await portalConversations(msp);
    expect(commentIds(conversations)).toEqual(sorted(ids.requester));
    const text = JSON.stringify(conversations);
    for (const secret of [body.sharedIt, body.mspPrivate, body.customerPrivate, `visible-reply-${MARK}`, `masked-child-${MARK}`]) expect(text).not.toContain(secret);
  });

  it('keeps the customer private body out of every sponsor-tenant table', async () => {
    expect(await tablesContaining(msp.tenant, body.customerPrivate)).toEqual([]);
    // positive controls: the scan can find a body, and the private store holds exactly this one
    expect(await tablesContaining(msp.tenant, body.mspPrivate)).toEqual(expect.arrayContaining(['comments']));
    expect(await tablesContaining(customer, body.customerPrivate)).toEqual(['co_management_private_comments']);
    // the MSP-private body never travels to the customer tenant either
    expect(await tablesContaining(customer, body.mspPrivate)).toEqual([]);
    expect(await db('comments').where({ tenant: msp.tenant }).whereRaw('comment_publication_payload::text ILIKE ?', [`%${body.customerPrivate}%`])).toHaveLength(0);
  });

  it('search never serves a non-requester audience to the requester (indexer and verifier)', async () => {
    const { ticketCommentIndexer } = await import('../../../../packages/search/src/indexers/ticket_comment');
    const { verifyResultVisibility } = await import('../../../../packages/search/src/acl');
    const mine = [ids.requester, ids.sharedIt, ids.mspPrivate, replyId, damagedId, childId];
    const docs = (await ticketCommentIndexer.loadBatch(db, msp.tenant, null, 1000)).filter(doc => mine.includes(doc.objectId));
    const publicDocs = docs.filter(doc => !doc.acl?.isInternalOnly).map(doc => doc.objectId);
    expect(publicDocs).toEqual([ids.requester]);
    expect(docs.map(d => d.objectId)).not.toContain(ids.customerPrivate);
    expect(JSON.stringify(docs)).not.toContain(body.customerPrivate);
    expect((await ticketCommentIndexer.loadOne(db, msp.tenant, ids.sharedIt))!.acl?.isInternalOnly).toBe(true);
    expect((await ticketCommentIndexer.loadOne(db, msp.tenant, ids.mspPrivate))!.acl?.isInternalOnly).toBe(true);

    const rows = mine.map(id => ({ type: 'ticket_comment' as const, id, parentId: msp.ticketId }));
    const requester = { userId: msp.portalUserId, tenant: msp.tenant, permissions: ['ticket:read'], isInternal: false, clientAccess: { mode: 'scoped' as const, clientIds: [msp.clientId] } };
    expect((await verifyResultVisibility(db, requester, rows)).map(r => r.id)).toEqual([ids.requester]);
    const staff = { ...requester, userId: msp.techId, isInternal: true, clientAccess: { mode: 'all' as const } };
    expect((await verifyResultVisibility(db, staff, rows)).map(r => r.id).sort()).toEqual(sorted(...mine));
  });

  it('publishes isInternal true for every non-requester audience, immediate and scheduled', async () => {
    const { dispatchCommentPublication } = await import('../../../../shared/lib/ticketCommentAttachments');
    const { buildTicketCommentAddedPayload } = await import('../../../../shared/lib/tickets/ticketWorkflowEventPayloads');
    const published: any[] = [];
    const publisher = async (event: any) => { published.push(event); };
    const dispatch = async (id: string) => {
      await db('comments').where({ tenant: msp.tenant, comment_id: id }).update({ scheduled_publish_dispatched_at: null });
      published.length = 0;
      await dispatchCommentPublication(db, msp.tenant, id, publisher);
      expect(published, id).toHaveLength(1);
      return published[0].payload;
    };
    // Intents written by the shared command
    const requesterPayload = await dispatch(ids.requester);
    expect(requesterPayload.comment.isInternal).toBe(false);
    const sharedPayload = await dispatch(ids.sharedIt);
    expect(sharedPayload).toMatchObject({ collaboration_audience: 'shared_it', comment: { audience: 'shared_it', isInternal: true } });
    const replyPayload = await dispatch(replyId);
    expect(replyPayload.comment.isInternal).toBe(true);
    // Scheduled labelled comment: the stored intent was damaged to say public, the row flag too.
    // A labelled audience is stronger than either flag, and can never be republished as public.
    for (const audience of ['shared_it', 'organization_private'] as const) {
      const scheduledId = uuidv4();
      await createShared(mspTech, { operationId: scheduledId, audience, text: `scheduled-${audience}-${MARK}` });
      const intent = buildTicketCommentAddedPayload({ tenantId: msp.tenant, occurredAt: new Date().toISOString(), ticketId: msp.ticketId, commentId: scheduledId, userId: msp.techId,
        comment: { content: 'x', author: 'Morgan Tech', isInternal: false, authorType: 'internal' }, collaboration_audience: audience });
      const damaged = { ...intent, comment: { ...(intent as any).comment, isInternal: false } };
      await db('comments').where({ tenant: msp.tenant, comment_id: scheduledId }).update({ is_internal: false, comment_publication_payload: JSON.stringify({ ...damaged, commentId: scheduledId }),
        scheduled_publish_event_id: uuidv4() });
      expect((await dispatch(scheduledId)).comment.isInternal, audience).toBe(true);
    }
    // Native private note (legacy NULL audience): the row flag carries it
    const noteEventId = uuidv4();
    await db('comments').where({ tenant: msp.tenant, comment_id: ids.mspPrivate }).update({ scheduled_publish_event_id: noteEventId,
      comment_publication_payload: JSON.stringify({ ...buildTicketCommentAddedPayload({ tenantId: msp.tenant, occurredAt: new Date().toISOString(), ticketId: msp.ticketId, commentId: ids.mspPrivate,
        userId: msp.techId, comment: { content: 'x', author: 'Morgan Tech', isInternal: true, authorType: 'internal' } }), commentId: ids.mspPrivate }) });
    expect((await dispatch(ids.mspPrivate)).comment.isInternal).toBe(true);
    // Nothing published anywhere carries the customer's private body
    expect(JSON.stringify(published)).not.toContain(body.customerPrivate);
    expect(await db('comments').where({ tenant: msp.tenant }).whereRaw('comment_publication_payload::text ILIKE ?', [`%${body.customerPrivate}%`])).toHaveLength(0);
  });
});

describe('native neutrality (no co-managed entitlement)', () => {
  const cases = [
    { name: 'Kansas (co-managed flag off)', coManaged: false },
    { name: 'Emerald (flag on, no entitlement)', coManaged: true },
  ];
  for (const { name, coManaged } of cases) {
    it(`${name}: NULL audiences, unchanged portal visibility`, async () => {
      resetAdmission(coManaged);
      try {
        const world = await seedWorld(name.split(' ')[0]);
        const { default: Comment } = await import('../../../../packages/tickets/src/models/comment');
        const base = { ticket_id: world.ticketId, user_id: world.techId, author_type: 'internal', is_resolution: false } as const;
        const publicId = await Comment.insert(db, world.tenant, { ...base, is_internal: false, note: `public-${MARK}`, markdown_content: `public-${MARK}` } as any);
        const noteId = await Comment.insert(db, world.tenant, { ...base, is_internal: true, note: `internal-${MARK}`, markdown_content: `internal-${MARK}` } as any);
        const threads = await tenantDb(db, world.tenant).table('comments as c')
          .join('comment_threads as t', function () { this.on('t.thread_id', 'c.thread_id').andOn('t.tenant', 'c.tenant'); })
          .whereIn('c.comment_id', [publicId, noteId]).select('c.comment_id', 't.collaboration_audience');
        expect(threads).toHaveLength(2);
        for (const thread of threads) expect(thread.collaboration_audience).toBeNull();
        const conversations = await portalConversations(world);
        expect(commentIds(conversations)).toEqual([publicId]);
        expect(JSON.stringify(conversations)).not.toContain(`internal-${MARK}`);
        // The tenant never had a collaboration audience written anywhere.
        expect(await db('comment_threads').where({ tenant: world.tenant }).whereNotNull('collaboration_audience')).toHaveLength(0);
      } finally {
        resetAdmission(false);
      }
    });
  }
});
