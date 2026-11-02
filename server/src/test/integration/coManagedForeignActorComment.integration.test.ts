/**
 * CM L4a deploy-fix: a FOREIGN actor (a sponsor technician) posts on a customer-owned shared ticket.
 * writeTicketActivity records the actor reference on ticket_audit_logs (actor_reference_id /
 * actor_organization_name); before the ticket_audit_logs actor-reference columns existed (L3b1, 20261029140400) that insert failed and rolled the whole post back.
 *
 * DB-backed and deliberately NOT mocking writeTicketActivity. Only the admission wrapper, session
 * expiry, lifecycle admission and transport are stand-ins; comment, thread, actor reference, audit row
 * and receipt are real rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

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

let db: Knex, customer: string, sponsor: string, techId: string, actor: any, resource: any;

beforeAll(async () => {
  db = await createTestDbConnection();
  customer = await createTenant(db, 'Customer');
  sponsor = await createTenant(db, 'Disposable Enable IT');
  const ownerId = await createUser(db, customer, { first_name: 'Casey', last_name: 'Owner' });
  techId = await createUser(db, sponsor, { first_name: 'Sam', last_name: 'Tech', user_type: 'internal' });
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), ticketId = uuidv4(), relationshipId = uuidv4();
  await db('clients').insert({ tenant: customer, client_id: clientId, client_name: 'Acme', billing_cycle: 'monthly', is_tax_exempt: false });
  await db('boards').insert({ tenant: customer, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant: customer, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ownerId });
  await db('statuses').insert({ tenant: customer, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ownerId });
  await db('tickets').insert({ tenant: customer, ticket_id: ticketId, ticket_number: `T-${Date.now()}`, title: 'Shared', client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: ownerId });
  await db('co_management_relationships').insert({ tenant: customer, relationship_id: relationshipId, sponsor_tenant: sponsor, sponsor_client_id: uuidv4() });
  actor = { kind: 'session', tenant: sponsor, userId: techId, sessionId: uuidv4() };
  resource = { kind: 'ticket', tenant: customer, relationshipId, id: ticketId };
});
afterAll(async () => { await db?.destroy(); });

const create = async (request: any) => (await import('@alga-psa/co-managed/sharedTicketCommentWriter')).createSharedTicketComment(db, actor, resource, request);

describe('foreign actor shared comment', () => {
  it.each(['shared_it', 'requester'] as const)('persists a %s comment with its audit row and actor attribution', async audience => {
    const receipt = await create({ operationId: uuidv4(), audience, text: `from the sponsor (${audience})` });
    const comment = await db('comments').where({ tenant: customer, comment_id: receipt.commentId }).first();
    expect(comment).toMatchObject({ user_id: null, actor_display_name: 'Sam Tech', actor_organization_name: 'Disposable Enable IT', is_internal: audience !== 'requester' });
    expect(comment.actor_reference_id).toBeTruthy();
    const audit = await db('ticket_audit_logs').where({ tenant: customer, entity_id: receipt.commentId }).first();
    expect(audit).toBeTruthy();
    expect(audit.actor_reference_id).toBe(comment.actor_reference_id);
    expect(audit.actor_organization_name).toBe('Disposable Enable IT');
    expect(audit.actor_user_id).toBeNull();
    expect(await db('collaboration_actor_references').where({ tenant: customer, actor_reference_id: audit.actor_reference_id, actor_tenant: sponsor, actor_user_id: techId })).toHaveLength(1);
  });

  it('persists a foreign reply and its audit row', async () => {
    const root = await create({ operationId: uuidv4(), audience: 'shared_it', text: 'root' });
    const reply = await create({ operationId: uuidv4(), parent: { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId }, text: 'reply' });
    expect(await db('comments').where({ tenant: customer, comment_id: reply.commentId }).first()).toMatchObject({ parent_comment_id: root.commentId });
    expect(await db('ticket_audit_logs').where({ tenant: customer, entity_id: reply.commentId }).first()).toMatchObject({ actor_organization_name: 'Disposable Enable IT' });
  });
});
