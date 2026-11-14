/**
 * alga-2026-0002993 F2 (MSP half): a bundle-restricted internal user must not create, edit, delete or react on
 * comments of a ticket the record authorizer denies them. Real authorization kernel and real bundle service;
 * only the session seam (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import {
  loadAuthorizationEvaluationSnapshot,
  resolveBundleNarrowingRulesForEvaluation,
  bundleNarrowingRuleFromRow,
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));

// A client role's real coarse grant is ticket:read (and ticket:update for replying); the record-level decision
// under test must come from the real kernel, so nothing else is faked.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) =>
    resource === 'ticket' && (action === 'read' || action === 'update')),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('../../../../packages/tickets/src/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));

import {
  createComment,
  updateComment,
  deleteComment,
} from '../../../../packages/tickets/src/actions/comment-actions/commentActions';
import { toggleCommentReaction } from '../../../../packages/tickets/src/actions/comment-actions/commentReactionActions';
import Comment from '../../../../packages/tickets/src/models/comment';
import { authorizeTicketRecordAccess } from '../../../../packages/tickets/src/lib/ticketRecordAuthorization';

const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

async function outcome<T>(run: () => Promise<T>): Promise<{ value: T } | { threw: string }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

describe('commentActions: own_or_assigned bundle-restricted MSP user (real authorization kernel)', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    client: uuidv4(), board: uuidv4(), status: uuidv4(), priority: uuidv4(),
    assignedTicket: uuidv4(), foreignTicket: uuidv4(), techId: '', otherId: '', restrictedId: '',
    foreignComment: '', restrictedOwnForeignComment: '',
  };
  const countComments = async (ticketId: string) =>
    Number((await db('comments').where({ tenant, ticket_id: ticketId }).count<{ count: string }[]>('* as count'))[0].count);

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `MSP comment authz ${mark}`);
    ref.tenant = tenant;
    ids.techId = await createUser(db, tenant, { first_name: 'Morgan', last_name: 'Tech' });
    ids.otherId = await createUser(db, tenant, { first_name: 'Other', last_name: 'Agent' });
    ids.restrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Scarecrow', last_name: 'Restricted' });

    await db('clients').insert({ tenant, client_id: ids.client, client_name: `Authz Client ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.techId });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.techId });

    // Assigned ticket: assigned to the restricted user. Foreign ticket: entered by and assigned to someone else.
    for (const [ticketId, label, assignedTo, enteredBy] of [
      [ids.assignedTicket, 'ASSIGNED', ids.restrictedId, ids.techId],
      [ids.foreignTicket, 'FOREIGN', ids.otherId, ids.techId],
    ] as const) {
      await db('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: ids.client, board_id: ids.board, status_id: ids.status, priority_id: ids.priority,
        entered_by: enteredBy, assigned_to: assignedTo,
      });
    }
    ids.foreignComment = await Comment.insert(db, tenant, { ticket_id: ids.foreignTicket, user_id: ids.restrictedId, author_type: 'internal', is_internal: false, note: `pre-existing-${mark}`, markdown_content: `pre-existing-${mark}`, is_resolution: false } as any);

    // Active bundle assignment: ticket read + update narrowed to own_or_assigned.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `own-or-assigned-${mark}`, actorUserId: ids.techId });
    for (const action of ['read', 'update']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'ticket', action, templateKey: 'own_or_assigned', config: {}, actorUserId: ids.techId,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.techId });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.restrictedId, actorUserId: ids.techId });

    ref.user = { user_id: ids.restrictedId, user_type: 'internal', tenant, email: `restricted-${mark}@example.com` };
  });

  afterAll(async () => {
    if (db) {
      try {
        const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
        let pending: string[] = rows.map((r: any) => r.table_name);
        for (let pass = 0; pass < 12 && pending.length; pass++) {
          const blocked: string[] = [];
          for (const table of pending) {
            try { await db.raw('DELETE FROM ?? WHERE tenant = ?::uuid', [table, tenant]); } catch { blocked.push(table); }
          }
          if (blocked.length === pending.length) break;
          pending = blocked;
        }
        if (pending.length) process.stderr.write(`msp comment authz cleanup left tables: ${pending.join(', ')}\n`);
      } catch (error) {
        process.stderr.write(`msp comment authz cleanup skipped: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      await db.destroy();
    }
  });

  it('createComment on a ticket neither owned by nor assigned to the user is denied and inserts nothing', async () => {
    const before = await countComments(ids.foreignTicket);
    const attempt = await outcome(() => createComment({
      ticket_id: ids.foreignTicket, note: note(`intrusion-${mark}`), is_internal: true, is_resolution: false,
    } as any));
    expect(await countComments(ids.foreignTicket)).toBe(before);
    expect(JSON.stringify(attempt)).toMatch(/Ticket not found/);

    // Indistinguishable from naming a ticket that does not exist.
    const missing = await outcome(() => createComment({
      ticket_id: uuidv4(), note: note(`intrusion-${mark}`), is_internal: true, is_resolution: false,
    } as any));
    expect(attempt).toEqual(missing);
  });

  it('createComment on an assigned ticket succeeds', async () => {
    const result: any = await createComment({
      ticket_id: ids.assignedTicket, note: note(`ok-${mark}`), is_internal: true, is_resolution: false,
    } as any);
    expect(typeof result).toBe('string');
    const row = await db('comments').where({ tenant, comment_id: result }).first();
    expect(row?.author_type).toBe('internal');
    expect(row?.ticket_id).toBe(ids.assignedTicket);
  });

  it('updateComment / deleteComment / toggleCommentReaction on a comment of an inaccessible ticket are denied', async () => {
    const upd = await outcome(() => updateComment(ids.foreignComment, { note: note('edited') } as any));
    expect(JSON.stringify(upd)).toMatch(/Ticket not found/);
    const react = await outcome(() => toggleCommentReaction(ids.foreignComment, '👍'));
    expect(JSON.stringify(react)).toMatch(/Permission denied/);
    const del = await outcome(() => deleteComment(ids.foreignComment));
    expect(JSON.stringify(del)).toMatch(/Ticket not found/);

    const row = await db('comments').where({ tenant, comment_id: ids.foreignComment }).first();
    expect(row).toBeTruthy();
    expect(String(row.note)).toContain(`pre-existing-${mark}`);
    expect(await db('comment_reactions').where({ tenant, comment_id: ids.foreignComment })).toHaveLength(0);
  });

  it.each(['role', 'team'] as const)('loads %s-targeted bundle rules with current memberships in the record decision', async (targetType) => {
    const trx = await db.transaction();
    try {
      const targetId = uuidv4();
      if (targetType === 'role') {
        await trx('roles').insert({ tenant, role_id: targetId, role_name: `snapshot-${mark}`, msp: true, client: false });
        await trx('user_roles').insert({ tenant, role_id: targetId, user_id: ids.restrictedId });
      } else {
        await trx('teams').insert({ tenant, team_id: targetId, team_name: `snapshot-${mark}`, manager_id: ids.techId });
        await trx('team_members').insert({ tenant, team_id: targetId, user_id: ids.restrictedId });
      }
      await trx('users').where({ tenant, user_id: ids.otherId }).update({ reports_to: ids.restrictedId });
      const bundle = await createAuthorizationBundle(trx, { tenant, name: `snapshot-${targetType}-${mark}` });
      await upsertBundleRule(trx, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'ticket', action: 'update', templateKey: 'own', config: {},
      });
      await publishBundleRevision(trx, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId });
      await createBundleAssignment(trx, { tenant, bundleId: bundle.bundleId, targetType, targetId });
      const subject = { tenant, userId: ids.restrictedId, userType: 'internal' as const };
      const snapshot = await loadAuthorizationEvaluationSnapshot(trx, subject);
      expect(snapshot[targetType === 'role' ? 'roleIds' : 'teamIds']).toContain(targetId);
      expect(snapshot.managedUserIds).toContain(ids.otherId);
      const legacyRules = await resolveBundleNarrowingRulesForEvaluation(trx, {
        subject, resource: { type: 'ticket', action: 'update' },
      });
      expect(snapshot.rules.map(bundleNarrowingRuleFromRow).sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual(legacyRules.sort((a, b) => a.id.localeCompare(b.id)));
      const authorize = () => authorizeTicketRecordAccess({
        trx, tenant, user: ref.user, ticketId: ids.assignedTicket, action: 'update',
      });
      // The existing direct bundle allows an assigned ticket; the newly targeted
      // 'own' rule must narrow it further, even with no roles supplied in the session.
      await expect(authorize()).rejects.toThrow('Permission denied');
      await trx(targetType === 'role' ? 'user_roles' : 'team_members')
        .where({ tenant, user_id: ids.restrictedId, [targetType === 'role' ? 'role_id' : 'team_id']: targetId }).del();
      await expect(authorize()).resolves.toMatchObject({ ticket_id: ids.assignedTicket });
    } finally {
      await trx.rollback();
    }
  });

  it('returns the normalized stored comment from insert and update, including thread identity and timestamps', async () => {
    const trx = await db.transaction();
    try {
      const inserted = await Comment.insertRecord(trx, tenant, {
        ticket_id: ids.assignedTicket, user_id: ids.restrictedId,
        author_type: 'client', is_internal: true, note: note('returned row'),
        markdown_content: 'returned row', is_resolution: false,
      } as any);
      expect(inserted.author_type).toBe('internal');
      expect(inserted.thread_id).toBeTruthy();
      expect(inserted.created_at).toBeTruthy();
      expect(inserted).toEqual(await Comment.get(trx, tenant, inserted.comment_id!));
      const updated = await Comment.update(trx, tenant, inserted.comment_id!, { note: note('updated row') }, ids.restrictedId);
      expect(updated.note).toBe(note('updated row'));
      expect(updated.thread_id).toBe(inserted.thread_id);
      expect(updated).toEqual(await Comment.get(trx, tenant, inserted.comment_id!));
      await expect(Comment.deleteRecord(trx, uuidv4(), updated)).rejects.toThrow('Invalid comment identity');
      expect(await Comment.get(trx, tenant, inserted.comment_id!)).toBeTruthy();
      await Comment.deleteRecord(trx, tenant, updated);
      expect(await Comment.get(trx, tenant, inserted.comment_id!)).toBeUndefined();
      expect(await trx('comment_threads').where({ tenant, thread_id: inserted.thread_id }).first()).toBeUndefined();
    } finally {
      await trx.rollback();
    }
  });

});
