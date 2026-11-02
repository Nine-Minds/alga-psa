/**
 * Tenant scoping of conversation authors, on the real schema. A customer-store user and contact comment on a ticket the
 * customer owns; a sponsor-side reader (foreign) must never receive their raw ids from EITHER exported conversation action,
 * only a stable uuidv5 reference. The owner's own reader keeps the ids. Stand-ins: admission wrappers, session expiry,
 * capability gate, auth/session seam. Comment rows, threads and the reader SQL are real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

let currentUser: any, testDb: Knex;
const admit = async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, action: _action, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: async () => {} }));
vi.mock('../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async (user: any, tenant: string) => ({ kind: 'session', tenant, userId: user.user_id, sessionId: uuidv4() }) }));
vi.mock('@alga-psa/auth', async importOriginal => ({ ...(await importOriginal<any>()),
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args) }));
vi.mock('@alga-psa/db', async importOriginal => ({ ...(await importOriginal<any>()),
  getConnection: async () => testDb, createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? currentUser?.tenant }) }));

const NS = '6f0c5e0e-3a54-4f0b-9f0d-5b7f2f5a1c11';
let db: Knex, owner: string, sponsor: string, ownerUserId: string, contactId: string, sponsorTech: string, ticketId: string, relationshipId: string, clientId: string;
const tenants: string[] = [];
const ids = { user: '', contact: '', own: '' };
let resource: any;

beforeAll(async () => {
  db = await createTestDbConnection(); testDb = db;
  (globalThis as any).__algaWriteAdmissionResolver = undefined;
  owner = await createTenant(db, 'Owner Co'); sponsor = await createTenant(db, 'Sponsor MSP');
  tenants.push(owner, sponsor);
  ownerUserId = await createUser(db, owner, { first_name: 'Dana', last_name: 'Reyes' });
  sponsorTech = await createUser(db, sponsor, { first_name: 'Sam', last_name: 'Tech', user_type: 'internal' });
  clientId = uuidv4(); contactId = uuidv4(); ticketId = uuidv4(); relationshipId = uuidv4();
  const boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4();
  await db('clients').insert({ tenant: owner, client_id: clientId, client_name: 'Acme', billing_cycle: 'monthly', is_tax_exempt: false });
  await db('contacts').insert({ tenant: owner, contact_name_id: contactId, full_name: 'Rita Requester', email: `rita-${contactId}@example.com`, client_id: clientId });
  await db('boards').insert({ tenant: owner, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant: owner, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ownerUserId });
  await db('statuses').insert({ tenant: owner, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ownerUserId });
  await db('tickets').insert({ tenant: owner, ticket_id: ticketId, ticket_number: `T-${Date.now()}`, title: 'Shared', client_id: clientId, contact_name_id: contactId,
    board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: ownerUserId });
  await db('co_management_relationships').insert({ tenant: owner, relationship_id: relationshipId, sponsor_tenant: sponsor, sponsor_client_id: uuidv4() });
  resource = { kind: 'ticket', tenant: owner, relationshipId, id: ticketId };
  const { default: Comment } = await import('../../../../packages/tickets/src/models/comment');
  const base = { ticket_id: ticketId, is_internal: false, is_resolution: false } as any;
  ids.user = await Comment.insert(db, owner, { ...base, user_id: ownerUserId, author_type: 'internal', note: 'by user', markdown_content: 'by user' });
  ids.contact = await Comment.insert(db, owner, { ...base, user_id: ownerUserId, author_type: 'internal', note: 'by contact', markdown_content: 'by contact' });
  // The comment model requires a user author; a contact-authored row is the same row re-attributed.
  await db('comments').where({ tenant: owner, comment_id: ids.contact }).update({ user_id: null, contact_id: contactId, author_type: 'client' });
}, 120_000);

afterAll(async () => {
  if (!db) return;
  try {
    let pending: string[] = (await db.raw(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant'`)).rows.map((r: any) => r.table_name);
    for (let pass = 0; pass < 12 && pending.length; pass++) {
      const blocked: string[] = [];
      for (const table of pending) { try { await db.raw('DELETE FROM ?? WHERE tenant = ANY(?::uuid[])', [table, tenants]); } catch { blocked.push(table); } }
      if (blocked.length === pending.length) break;
      pending = blocked;
    }
  } catch { /* best-effort cleanup */ }
  await db.destroy();
});

const actions = () => import('../../lib/actions/coManagedTicketConversationActions');
const as = (tenant: string, user_id: string) => { currentUser = { user_id, tenant, user_type: 'internal' }; };

describe('conversation author shaping across the action boundary', () => {
  it.each(['getCoManagedTicketConversationAction', 'getCoManagedTicketConversationScreenAction'] as const)('%s: a foreign reader gets no raw author ids, only stable references', async name => {
    as(sponsor, sponsorTech);
    const load = async () => (await actions())[name](resource) as Promise<any>;
    const first = await load(), second = await load();
    const byId = (page: any, id: string) => page.items.find((i: any) => i.commentId === id);
    expect(byId(first, ids.user).author).toMatchObject({ id: null, kind: 'user', tenant: owner, displayName: 'Dana Reyes', referenceId: uuidv5(`${owner}:user:${ownerUserId}`, NS) });
    expect(byId(first, ids.contact).author).toMatchObject({ id: null, kind: 'contact', tenant: owner, referenceId: uuidv5(`${owner}:contact:${contactId}`, NS) });
    expect(byId(second, ids.user).author.referenceId).toBe(byId(first, ids.user).author.referenceId);
    const payload = JSON.stringify(first);
    for (const raw of [ownerUserId, contactId]) expect(payload).not.toContain(raw);
  });

  it('the owner\'s own reader keeps author ids', async () => {
    as(owner, ownerUserId);
    const page: any = await (await actions()).getCoManagedTicketConversationAction({ ...resource });
    expect(page.items.find((i: any) => i.commentId === ids.user).author).toMatchObject({ id: ownerUserId, tenant: owner });
    expect(page.items.find((i: any) => i.commentId === ids.contact).author).toMatchObject({ id: contactId, tenant: owner });
  });

  it('a foreign reply still targets the foreign comment\'s store, thread and comment', async () => {
    as(sponsor, sponsorTech);
    const page: any = await (await actions()).getCoManagedTicketConversationAction(resource);
    const target = page.items.find((i: any) => i.commentId === ids.user);
    expect(target).toMatchObject({ storeTenant: owner, commentId: ids.user });
    expect(target.threadId).toBeTruthy();
    const actor = { kind: 'session', tenant: sponsor, userId: sponsorTech, sessionId: uuidv4() };
    const { createSharedTicketComment } = await import('@alga-psa/co-managed/sharedTicketCommentWriter');
    const receipt = await createSharedTicketComment(db, actor as any, resource, { operationId: uuidv4(), parent: { storeTenant: target.storeTenant, threadId: target.threadId, commentId: target.commentId }, text: 'reply' });
    expect(receipt).toMatchObject({ storeTenant: owner, threadId: target.threadId });
    expect(await db('comments').where({ tenant: owner, comment_id: receipt.commentId }).first()).toMatchObject({ parent_comment_id: ids.user });
  });
});
