/**
 * CM L4a: org-private notes live in the author's tenant (co_management_private_*),
 * written once per command with a receipt row, idempotent by command id; deleting a
 * root leaves a redacted tombstone and keeps its replies.
 *
 * DB-backed. Only the shared-work admission seam, the session-expiry check, lifecycle
 * write admission and evidence retention are stand-ins (their own suites cover them);
 * the command, its receipts and the private store are real rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => {
  const actual = await importOriginal<any>();
  return { ...actual, withCoManagedSharedWork: async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
    const run = (trx: Knex.Transaction) => work({ trx, actor, resource, sessionId: actor.sessionId, redactedFields: [] });
    return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
  } };
});
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('../../../../packages/co-managed/src/privateParticipationEvidence', () => ({ retainCoManagedPrivateParticipation: async () => {} }));

let db: Knex, msp: string, customer: string, userId: string, actor: any, resource: any;

beforeAll(async () => {
  db = await createTestDbConnection();
  msp = await createTenant(db, 'MSP'); customer = await createTenant(db, 'Customer');
  userId = await createUser(db, msp, { first_name: 'Morgan', last_name: 'Provider' });
  actor = { kind: 'session', tenant: msp, userId, sessionId: uuidv4() };
  resource = { kind: 'ticket', tenant: customer, relationshipId: uuidv4(), id: uuidv4() };
});
afterAll(async () => { await db?.destroy(); });

const mutate = async (command: any) => (await import('../../../../packages/co-managed/src/privateTicketConversation')).mutateCoManagedPrivateTicketComment(db, actor, resource, command);

describe('private note receipts (A2) and tombstones', () => {
  it('replays an identical command to the original receipt and writes exactly one row', async () => {
    const create = { kind: 'create' as const, operationId: uuidv4(), text: 'Only the MSP sees this' };
    const first = await mutate(create);
    expect(await mutate(create)).toEqual(first);
    expect(await db('co_management_private_comments').where({ tenant: msp, comment_id: create.operationId })).toHaveLength(1);
    expect(await db('co_management_private_command_receipts').where({ tenant: msp, operation_id: create.operationId })).toHaveLength(1);
    // Nothing is duplicated into the shared (customer) tenant.
    expect(await db('co_management_private_comments').where({ tenant: customer })).toHaveLength(0);
    expect(await db('comments').where({ tenant: customer })).toHaveLength(0);
  });
  it('refuses a reused command id carrying a different command', async () => {
    const operationId = uuidv4();
    await mutate({ kind: 'create', operationId, text: 'one' });
    await expect(mutate({ kind: 'create', operationId, text: 'two' })).rejects.toMatchObject({ code: 'PRIVATE_COMMENT_OPERATION_CONFLICT' });
  });
  it('tombstones a deleted root, keeps its replies and leaves later retries idempotent', async () => {
    const root = await mutate({ kind: 'create', operationId: uuidv4(), text: 'root' });
    const ref = { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId };
    const reply = await mutate({ kind: 'create', operationId: uuidv4(), parent: ref, text: 'reply' });
    const remove = { kind: 'delete' as const, operationId: uuidv4(), comment: ref, expectedRevision: 1 };
    const deleted = await mutate(remove);
    expect(deleted.revision).toBe(2);
    expect(await mutate(remove)).toEqual(deleted);
    const rootRow = await db('co_management_private_comments').where({ tenant: msp, comment_id: root.commentId }).first();
    expect(rootRow).toMatchObject({ note: '[deleted]', markdown_content: '[deleted]' });
    expect(rootRow.deleted_at).not.toBeNull();
    const replyRow = await db('co_management_private_comments').where({ tenant: msp, comment_id: reply.commentId }).first();
    expect(replyRow.deleted_at).toBeNull(); expect(replyRow.parent_comment_id).toBe(root.commentId);
    // A tombstoned root accepts no new replies and no further edits.
    await expect(mutate({ kind: 'create', operationId: uuidv4(), parent: ref, text: 'late' })).rejects.toBeTruthy();
    await expect(mutate({ kind: 'edit', operationId: uuidv4(), comment: ref, expectedRevision: 2, text: 'revive' })).rejects.toMatchObject({ code: 'PRIVATE_COMMENT_CONFLICT' });
  });
});
