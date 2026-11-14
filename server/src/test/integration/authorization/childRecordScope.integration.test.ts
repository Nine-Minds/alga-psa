/**
 * T015 (alga-2026-0003210, S13): child records follow their parent's authorization scope.
 *
 *  - F022: project task comments use the parent project's decision on every server action and on the REST
 *    service. A subject narrowed to client A is refused on a client B project, and counts do not leak.
 *  - F023: a ticket bundle shows a narrowed subject only the in-scope children, and only the replies mirrored
 *    from those children, narrowed in SQL (so the 200-row cap counts in-scope replies only).
 *
 * Real DB, real kernel, real bundle resolution. Only the session (withAuth), the DB handle and the coarse RBAC
 * grant are stood in for, so the record-level decision under test comes from the bundle rules.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
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
// BaseService (the REST services) reads the tenant handle from the internal module.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', async () => (await import('../../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
}));

import {
  createTaskComment,
  deleteTaskComment,
  getTaskCommentCount,
  getTaskCommentCountsBatch,
  getTaskComments,
  updateTaskComment,
} from '../../../../../packages/projects/src/actions/projectTaskCommentActions';
import { ProjectTaskCommentService } from '../../../lib/api/services/ProjectTaskCommentService';
import {
  fetchBundleChildrenForMaster,
  getConsolidatedTicketData,
} from '../../../../../packages/tickets/src/actions/optimizedTicketActions';

import Comment from '../../../../../packages/tickets/src/models/comment';

const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

const isDenied = (result: unknown): boolean => {
  if (result && typeof result === 'object' && ('permissionError' in result || 'actionError' in result)) return true;
  return false;
};
async function outcome<T>(run: () => Promise<T>): Promise<{ value: T } | { threw: string }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}
const refused = (o: { value: unknown } | { threw: string }) => 'threw' in o || isDenied(o.value);

describe('T015: project task comments and ticket bundles follow their parent scope', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    clientA: uuidv4(), clientB: uuidv4(), board: uuidv4(), status: uuidv4(), priority: uuidv4(), projectStatus: uuidv4(),
    projectA: uuidv4(), projectB: uuidv4(), phaseA: uuidv4(), phaseB: uuidv4(), taskA: uuidv4(), taskB: uuidv4(),
    master: uuidv4(), childA: uuidv4(), childB: uuidv4(),
    admin: '', narrowed: '', unrestricted: '',
    commentA: '', commentB: '',
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Child scope ${mark}`);
    ref.tenant = tenant;
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });

    for (const [clientId, name] of [[ids.clientA, 'A'], [ids.clientB, 'B']] as const) {
      await db('clients').insert({ tenant, client_id: clientId, client_name: `Client ${name} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    }
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.projectStatus, name: 'Active', status_type: 'project', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });

    // Projects, phases and tasks, one per client.
    for (const [projectId, phaseId, taskId, clientId, label] of [
      [ids.projectA, ids.phaseA, ids.taskA, ids.clientA, 'A'],
      [ids.projectB, ids.phaseB, ids.taskB, ids.clientB, 'B'],
    ] as const) {
      await db('projects').insert({
        tenant, project_id: projectId, project_name: `Project ${label} ${mark}`, client_id: clientId, status: ids.projectStatus,
        wbs_code: `1${label === 'A' ? 1 : 2}`, project_number: `P-${mark}-${label}`, is_inactive: false,
      });
      await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${label}`, status: 'active', order_number: 1, wbs_code: `1${label === 'A' ? 1 : 2}.1` });
      await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: `Task ${label}`, wbs_code: `1${label === 'A' ? 1 : 2}.1.1` });
    }
    ref.user = { user_id: ids.admin, user_type: 'internal', tenant };
    // Pre-existing comments (written by the admin) so reads have something to leak.
    ids.commentA = await createTaskComment({ taskId: ids.taskA, note: note(`task-a-${mark}`) } as any) as string;
    ids.commentB = await createTaskComment({ taskId: ids.taskB, note: note(`task-b-${mark}`) } as any) as string;

    // Ticket bundle: master (client A) with one child per client, each child carrying a public reply.
    for (const [ticketId, label, clientId, masterId] of [
      [ids.master, 'MASTER', ids.clientA, null],
      [ids.childA, 'CHILD-A', ids.clientA, ids.master],
      [ids.childB, 'CHILD-B', ids.clientB, ids.master],
    ] as const) {
      await db('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: clientId, board_id: ids.board, status_id: ids.status, priority_id: ids.priority,
        entered_by: ids.admin, master_ticket_id: masterId,
      });
    }
    await db('ticket_bundle_settings').insert({ tenant, master_ticket_id: ids.master, mode: 'link_only', reopen_on_child_reply: false });
    for (const [ticketId, label] of [[ids.childA, 'A'], [ids.childB, 'B']] as const) {
      await Comment.insert(db, tenant, {
        ticket_id: ticketId, user_id: ids.admin, author_type: 'internal', is_internal: false, is_resolution: false,
        note: `reply-${label}-${mark}`, markdown_content: `reply-${label}-${mark}`,
      } as any);
    }

    // Narrowed subject: ticket and project reads limited to client A.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `client-a-${mark}`, actorUserId: ids.admin });
    for (const resourceType of ['ticket', 'project']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'selected_clients', config: { selectedClientIds: [ids.clientA] }, actorUserId: ids.admin,
      });
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'update', templateKey: 'selected_clients', config: { selectedClientIds: [ids.clientA] }, actorUserId: ids.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.narrowed, actorUserId: ids.admin });
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
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
    } catch {
      // best-effort cleanup of a disposable tenant
    }
    await db.destroy();
  }, 120_000);

  const actAs = (userId: string) => { ref.user = { user_id: userId, user_type: 'internal', tenant, email: `${userId}@example.com` }; };
  const serviceContext = (userId: string) => ({ tenant, userId, user: { user_id: userId, user_type: 'internal', tenant } }) as any;

  describe('F022 project task comments', () => {
    it('refuses every server action on an out-of-scope project and does not leak counts', async () => {
      actAs(ids.narrowed);
      expect(refused(await outcome(() => getTaskComments(ids.taskB)))).toBe(true);
      expect(refused(await outcome(() => createTaskComment({ taskId: ids.taskB, note: note('nope') } as any)))).toBe(true);
      expect(refused(await outcome(() => updateTaskComment(ids.commentB, { note: note('edit') })))).toBe(true);
      expect(refused(await outcome(() => deleteTaskComment(ids.commentB)))).toBe(true);
      expect(refused(await outcome(() => getTaskCommentCount(ids.taskB)))).toBe(true);

      const batch = await getTaskCommentCountsBatch([ids.taskA, ids.taskB]) as Record<string, number>;
      expect(batch[ids.taskB]).toBeUndefined();
      expect(batch[ids.taskA]).toBe(1);

      const remaining = await db('project_task_comments').where({ tenant, task_id: ids.taskB }).count<{ count: string }[]>('* as count');
      expect(Number(remaining[0].count)).toBe(1);
    });

    it('keeps an in-scope project working through the same actions', async () => {
      actAs(ids.narrowed);
      const comments = await getTaskComments(ids.taskA) as any[];
      expect(comments.map((c) => c.note)).toEqual(expect.arrayContaining([expect.stringContaining(`task-a-${mark}`)]));
      expect(await getTaskCommentCount(ids.taskA)).toBe(1);
      const created = await createTaskComment({ taskId: ids.taskA, note: note('in scope') } as any);
      expect(typeof created).toBe('string');
      expect(await deleteTaskComment(created as string)).toBeUndefined();
    });

    it('refuses the REST service on an out-of-scope project and serves an in-scope one', async () => {
      const service = new ProjectTaskCommentService();
      const context = serviceContext(ids.narrowed);
      await expect(service.listComments(ids.taskB, context)).rejects.toThrow();
      await expect(service.createComment(ids.taskB, { note: 'nope' }, context)).rejects.toThrow();
      await expect(service.updateComment(ids.taskB, ids.commentB, { note: 'edit' }, context)).rejects.toThrow();
      await expect(service.deleteComment(ids.taskB, ids.commentB, context)).rejects.toThrow();
      expect((await service.listComments(ids.taskA, context)).length).toBe(1);
    });

    it('an unnarrowed internal user still sees both projects', async () => {
      actAs(ids.unrestricted);
      expect(await getTaskCommentCount(ids.taskB)).toBe(1);
      expect(await getTaskCommentCount(ids.taskA)).toBe(1);
      const batch = await getTaskCommentCountsBatch([ids.taskA, ids.taskB]) as Record<string, number>;
      expect(batch).toMatchObject({ [ids.taskA]: 1, [ids.taskB]: 1 });
    });
  });

  describe('F023 ticket bundles', () => {
    it('shows a narrowed subject only in-scope children and their mirrored comments', async () => {
      actAs(ids.narrowed);
      const data = await getConsolidatedTicketData(ids.master);
      expect(data.bundle.children.map((c: any) => c.ticket_id)).toEqual([ids.childA]);
      expect(data.bundle.openChildrenCount).toBe(1);
      expect(data.aggregatedChildClientComments.map((c: any) => c.child_ticket_id)).toEqual([ids.childA]);
      expect(JSON.stringify(data.aggregatedChildClientComments)).not.toContain(`reply-B-${mark}`);
    });

    it('lists only in-scope children for the bundled list expansion', async () => {
      actAs(ids.narrowed);
      const result: any = await fetchBundleChildrenForMaster(ids.master);
      const rows: any[] = result.tickets ?? result.rows ?? result;
      expect(rows.map((r) => r.ticket_id)).toEqual([ids.childA]);
    });

    it('counts only in-scope replies toward the 200-reply cap', async () => {
      // A second bundle whose in-scope reply is older than 205 out-of-scope replies. Filtering after the
      // capped query (the previous behaviour) left the narrowed reader with no mirrored replies at all.
      const capIds = { master: uuidv4(), childA: uuidv4(), childB: uuidv4() };
      for (const [ticketId, label, clientId, masterId] of [
        [capIds.master, 'CAP-MASTER', ids.clientA, null],
        [capIds.childA, 'CAP-A', ids.clientA, capIds.master],
        [capIds.childB, 'CAP-B', ids.clientB, capIds.master],
      ] as const) {
        await db('tickets').insert({
          tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
          client_id: clientId, board_id: ids.board, status_id: ids.status, priority_id: ids.priority,
          entered_by: ids.admin, master_ticket_id: masterId,
        });
      }
      await db('ticket_bundle_settings').insert({ tenant, master_ticket_id: capIds.master, mode: 'link_only', reopen_on_child_reply: false });
      const replies = [
        { ticketId: capIds.childA, text: `cap-reply-A-${mark}`, minutesAgo: 1000 },
        ...Array.from({ length: 205 }, (_, i) => ({ ticketId: capIds.childB, text: `cap-reply-B${i}-${mark}`, minutesAgo: 500 - i })),
      ];
      for (const reply of replies) {
        const commentId = uuidv4();
        const threadId = uuidv4();
        const at = db.raw(`now() - (? * interval '1 minute')`, [reply.minutesAgo]);
        await db('comment_threads').insert({ tenant, thread_id: threadId, ticket_id: reply.ticketId, root_comment_id: commentId, is_internal: false });
        await db('comments').insert({
          tenant, comment_id: commentId, thread_id: threadId, ticket_id: reply.ticketId, user_id: ids.admin, author_type: 'internal',
          is_internal: false, is_resolution: false, note: reply.text, markdown_content: reply.text, created_at: at, updated_at: at,
        });
      }

      actAs(ids.narrowed);
      const narrowed = await getConsolidatedTicketData(capIds.master);
      expect(narrowed.aggregatedChildClientComments.map((c: any) => c.child_ticket_id)).toEqual([capIds.childA]);

      actAs(ids.unrestricted);
      const unrestricted = await getConsolidatedTicketData(capIds.master);
      expect(unrestricted.aggregatedChildClientComments).toHaveLength(200);
      expect(new Set(unrestricted.aggregatedChildClientComments.map((c: any) => c.child_ticket_id))).toEqual(new Set([capIds.childB]));
    });

    it('an unnarrowed internal user still sees every child and reply', async () => {
      actAs(ids.unrestricted);
      const data = await getConsolidatedTicketData(ids.master);
      expect(data.bundle.children.map((c: any) => c.ticket_id).sort()).toEqual([ids.childA, ids.childB].sort());
      expect(data.aggregatedChildClientComments.map((c: any) => c.child_ticket_id).sort()).toEqual([ids.childA, ids.childB].sort());
      const result: any = await fetchBundleChildrenForMaster(ids.master);
      const rows: any[] = result.tickets ?? result.rows ?? result;
      expect(rows.map((r) => r.ticket_id).sort()).toEqual([ids.childA, ids.childB].sort());
    });
  });
});
