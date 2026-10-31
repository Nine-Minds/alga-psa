/**
 * CM L4a: shared (customer-tenant) comments. Create is idempotent by command id through
 * co_management_command_receipts; replies inherit the thread audience; a deleted root keeps
 * a redacted tombstone, its replies and its audience.
 *
 * DB-backed. The shared-work admission wrapper, session expiry, lifecycle admission and
 * transport (event bus, live updates) are stand-ins; the comment writer, threads, activity,
 * publication intent and receipts are real rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const admit = async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));

let db: Knex, tenant: string, userId: string, actor: any, resource: any;

beforeAll(async () => {
  db = await createTestDbConnection();
  tenant = await createTenant(db, 'Customer');
  userId = await createUser(db, tenant, { first_name: 'Casey', last_name: 'Owner' });
  const sponsor = await createTenant(db, 'MSP');
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), ticketId = uuidv4(), relationshipId = uuidv4();
  const t = (name: string) => db(name);
  await t('clients').insert({ tenant, client_id: clientId, client_name: 'Acme', billing_cycle: 'monthly', is_tax_exempt: false });
  await t('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await t('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: userId });
  await t('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: userId });
  await t('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${Date.now()}`, title: 'Shared', client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: userId });
  await t('co_management_relationships').insert({ tenant, relationship_id: relationshipId, sponsor_tenant: sponsor, sponsor_client_id: uuidv4() });
  actor = { kind: 'session', tenant, userId, sessionId: uuidv4() };
  resource = { kind: 'ticket', tenant, relationshipId, id: ticketId };
});
afterAll(async () => { await db?.destroy(); });

const create = async (request: any) => (await import('../../lib/co-managed/createTicketComment')).createSharedTicketComment(db, actor, resource, request);
const mutate = async (request: any) => (await import('../../lib/co-managed/mutateTicketComment')).mutateSharedTicketComment(db, actor, resource, request);

describe('shared comment receipts and tombstones', () => {
  it('replays an identical create to the original receipt with one comment and one receipt row', async () => {
    const request = { operationId: uuidv4(), audience: 'shared_it' as const, text: 'IT only' };
    const first = await create(request);
    expect(await create(request)).toEqual(first);
    expect(await db('comments').where({ tenant, comment_id: request.operationId })).toHaveLength(1);
    expect(await db('co_management_command_receipts').where({ tenant, operation_id: request.operationId })).toHaveLength(1);
    expect(await db('comment_threads').where({ tenant, thread_id: first.threadId }).first()).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
    await expect(create({ ...request, text: 'different' })).rejects.toMatchObject({ code: 'COMMENT_CREATE_OPERATION_CONFLICT' });
  });
  it('lets a reply inherit the thread audience and refuses a mismatched expectation', async () => {
    const root = await create({ operationId: uuidv4(), audience: 'shared_it', text: 'root' });
    const parent = { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId };
    const reply = await create({ operationId: uuidv4(), parent, text: 'reply' });
    expect(reply.threadId).toBe(root.threadId);
    expect(await db('comments').where({ tenant, comment_id: reply.commentId }).first()).toMatchObject({ is_internal: true, parent_comment_id: root.commentId });
    await expect(create({ operationId: uuidv4(), parent, expectedAudience: 'requester', text: 'widen' })).rejects.toBeTruthy();
  });
  it('tombstones a deleted root: redacted body, replies preserved, audience unchanged, retry idempotent', async () => {
    const root = await create({ operationId: uuidv4(), audience: 'shared_it', text: 'root' });
    const parent = { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId };
    const reply = await create({ operationId: uuidv4(), parent, text: 'reply' });
    // The reader returns microsecond-exact timestamps; reproduce that here.
    const stamp = (await db.raw(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS v FROM comments WHERE tenant = ? AND comment_id = ?`, [tenant, root.commentId])).rows[0].v;
    const remove = { kind: 'delete' as const, operationId: uuidv4(), comment: parent, expectedUpdatedAt: stamp };
    const receipt = await mutate(remove);
    expect(receipt.deleted).toBe(true);
    expect(await mutate(remove)).toEqual(receipt);
    expect(await db('comments').where({ tenant, comment_id: root.commentId }).first()).toMatchObject({ note: '[deleted]', markdown_content: '[deleted]' });
    expect((await db('comments').where({ tenant, comment_id: root.commentId }).first()).deleted_at).not.toBeNull();
    expect((await db('comments').where({ tenant, comment_id: reply.commentId }).first()).deleted_at).toBeNull();
    expect(await db('comment_threads').where({ tenant, thread_id: root.threadId }).first()).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
  });
});
