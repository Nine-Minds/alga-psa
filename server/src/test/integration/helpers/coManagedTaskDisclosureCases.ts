/**
 * CM L4c: audience truth table for shared project-task conversations.
 *
 * One case per cell of (reader x audience), plus the conversation rules that make the table honest:
 * qualified author labels, edit stamps a revision, a stale revision is refused, and a delete leaves a
 * tombstone that keeps its replies. DB-backed on the L3c world (sponsor MSP + co_managed customer); nothing
 * about admission, receipts or the reader is mocked.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, cleanupL3cTenants, sessionActor,
  type L3cWorld, type L3cProject } from './coManagedL3cFixture';

export type Audience = 'requester' | 'shared_it' | 'organization_private';
export const AUDIENCES: Audience[] = ['requester', 'shared_it', 'organization_private'];

/** The customer-side and sponsor-side conversation world every L4c DB case builds on. */
export interface L4cWorld {
  db: Knex; world: L3cWorld; project: L3cProject; taskId: string;
  resource: { kind: 'project_task'; tenant: string; relationshipId: string; id: string };
  customerActor: ReturnType<typeof sessionActor>; techActor: ReturnType<typeof sessionActor>;
}

export async function seedL4cWorld(db: Knex): Promise<L4cWorld> {
  const world = await seedL3cWorld(db);
  // Commenting needs project:update on the customer's own workspace; the fixture grants read only.
  const permissionId = randomUUID();
  await db('permissions').insert({ tenant: world.customer, permission_id: permissionId, resource: 'project', action: 'update', msp: true, client: false });
  const adminRole = await db('roles').where({ tenant: world.customer, role_name: 'Admin', msp: true, client: false }).first();
  await db('role_permissions').insert({ tenant: world.customer, role_id: adminRole.role_id, permission_id: permissionId });
  const project = await seedL3cProject(db, world, 'Conversation project', ['Shared task']);
  await shareProject(db, world, project.projectId, true);
  const resource = { kind: 'project_task' as const, tenant: world.customer, relationshipId: world.relationshipId, id: project.taskIds[0] };
  const techActor = sessionActor(world.sponsor, world.technician);
  // The MSP participates once it holds a reference (assigning creates it).
  const { assignCoManagedProjectTask } = await import('@alga-psa/co-managed/projectTaskAssignments');
  await assignCoManagedProjectTask(db, techActor, resource, { assignee: { kind: 'user', id: world.technician.userId }, expectedRevision: null });
  return { db, world, project, taskId: project.taskIds[0], resource, customerActor: sessionActor(world.customer, world.customerStaff), techActor };
}

const text = (value: string) => ({ document: [{ type: 'paragraph', content: [{ type: 'text', text: value, styles: {} }] }] });

export function registerCoManagedTaskDisclosureCases() {
  describe('CM L4c task conversation audience truth table', () => {
    let db: Knex, w: L4cWorld;
    beforeAll(async () => {
      vi.doMock('@alga-psa/core/secrets', () => ({
        getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
        getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
      }));
      configureL3cDbEnv();
      db = await connectL3cDb();
      w = await seedL4cWorld(db);
    }, 180_000);
    afterAll(async () => {
      await cleanupL3cTenants(w?.world.tenants ?? []);
      await db?.destroy().catch(() => undefined);
    });

    const conversation = () => import('@alga-psa/co-managed/projectTaskConversation');
    const post = async (actor: L4cWorld['customerActor'], audience: Audience, body: string, extra: Record<string, unknown> = {}) => {
      const { mutateCoManagedProjectTaskComment } = await conversation();
      return mutateCoManagedProjectTaskComment(db, actor, w.resource, { operationId: randomUUID(), kind: 'create', ...(extra.parent ? {} : { audience }), ...text(body), ...extra } as any);
    };
    const read = async (actor: L4cWorld['customerActor']) => (await (await conversation()).getCoManagedProjectTaskConversation(db, actor, w.resource)).items;
    const bodies = (items: Array<{ note: string | null }>) => items.map(item => (item.note ? JSON.parse(item.note)[0].content[0].text : null));

    // Cells: [writer, audience, who can read it]. A customer's organization-private note never reaches the MSP;
    // an MSP organization-private note never reaches the customer; shared audiences reach both.
    const cells: Array<[('customer' | 'tech'), Audience, { customer: boolean; tech: boolean }]> = [
      ['customer', 'requester', { customer: true, tech: true }],
      ['customer', 'shared_it', { customer: true, tech: true }],
      ['customer', 'organization_private', { customer: true, tech: false }],
      ['tech', 'requester', { customer: true, tech: true }],
      ['tech', 'shared_it', { customer: true, tech: true }],
      ['tech', 'organization_private', { customer: false, tech: true }],
    ];
    it.each(cells)('%s writes %s: customer reader and MSP reader see exactly the audience', async (writer, audience, sees) => {
      const marker = `${writer}-${audience}-${randomUUID()}`;
      await post(writer === 'customer' ? w.customerActor : w.techActor, audience, marker);
      expect(bodies(await read(w.customerActor)).includes(marker)).toBe(sees.customer);
      expect(bodies(await read(w.techActor)).includes(marker)).toBe(sees.tech);
    });

    it('offers each side its write audiences', async () => {
      const { getCoManagedProjectTaskWriteAudiences } = await conversation();
      expect((await getCoManagedProjectTaskWriteAudiences(db, w.customerActor, w.resource)).sort()).toEqual([...AUDIENCES].sort());
      expect((await getCoManagedProjectTaskWriteAudiences(db, w.techActor, w.resource)).sort()).toEqual([...AUDIENCES].sort());
    });

    it('qualifies every author with a name and organization', async () => {
      const marker = `label-${randomUUID()}`;
      await post(w.techActor, 'shared_it', marker);
      const sponsorName = (await db('tenants').where({ tenant: w.world.sponsor }).first('client_name')).client_name;
      const item = (await read(w.customerActor)).find(row => bodies([row])[0] === marker)!;
      expect(item.author).toMatchObject({ kind: 'user', displayName: 'Test Project Manager', organizationName: sponsorName });
      expect(item.audience).toBe('shared_it');
    });

    it('stamps a revision on edit and refuses a stale one', async () => {
      const { mutateCoManagedProjectTaskComment, CoManagedTaskCommentError } = await conversation();
      const created = await post(w.customerActor, 'shared_it', 'first');
      const ref = { storeTenant: created.storeTenant, threadId: created.threadId, commentId: created.commentId };
      expect((await read(w.customerActor)).find(row => row.commentId === created.commentId)!.revision).toBe(1);
      await mutateCoManagedProjectTaskComment(db, w.customerActor, w.resource, { operationId: randomUUID(), kind: 'edit', comment: ref, expectedRevision: 1, ...text('second') } as any);
      const edited = (await read(w.customerActor)).find(row => row.commentId === created.commentId)!;
      expect(edited.revision).toBe(2);
      expect(bodies([edited])[0]).toBe('second');
      const stale = await mutateCoManagedProjectTaskComment(db, w.customerActor, w.resource,
        { operationId: randomUUID(), kind: 'edit', comment: ref, expectedRevision: 1, ...text('lost update') } as any).catch(e => e);
      expect(stale).toBeInstanceOf(CoManagedTaskCommentError);
      expect((stale as any).code).toBe('TASK_COMMENT_CONFLICT');
    });

    it('treats a legacy row with no revision and no author kind as revision 1 by a user', async () => {
      const created = await post(w.customerActor, 'shared_it', 'legacy');
      await db('project_task_comments').where({ tenant: w.world.customer, task_comment_id: created.commentId }).update({ collaboration_revision: null, author_kind: null });
      const item = (await read(w.customerActor)).find(row => row.commentId === created.commentId)!;
      expect(item.revision).toBe(1);
      expect(item.author?.kind).toBe('user');
    });

    it('a delete leaves a tombstone and keeps the replies attached', async () => {
      const { mutateCoManagedProjectTaskComment } = await conversation();
      const root = await post(w.customerActor, 'shared_it', 'root');
      const reply = await post(w.techActor, 'shared_it', 'reply', { parent: { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId } });
      await mutateCoManagedProjectTaskComment(db, w.customerActor, w.resource, { operationId: randomUUID(), kind: 'delete',
        comment: { storeTenant: root.storeTenant, threadId: root.threadId, commentId: root.commentId }, expectedRevision: 1 });
      const items = await read(w.customerActor);
      const tomb = items.find(row => row.commentId === root.commentId)!, kept = items.find(row => row.commentId === reply.commentId)!;
      expect(tomb).toMatchObject({ deleted: true, note: null, markdown: null, canReply: false });
      expect(kept).toMatchObject({ deleted: false, parentCommentId: root.commentId });
      expect(bodies([kept])[0]).toBe('reply');
      const row = await db('project_task_comments').where({ tenant: w.world.customer, task_comment_id: root.commentId }).first();
      expect(row.deleted_at).toBeTruthy();
      expect(row.note).toBe('[deleted]');
      expect(row.collaboration_revision).toBe(2);
    });

    // DNP #18: an access filter expressed as an id list capped at 1000 would silently zero the board counts past it.
    it('counts comments for more than 1000 tasks in one unbounded batch (no id-list cap)', async () => {
      // Counting never publishes; keep the event graph out of this DB test.
      vi.doMock('@alga-psa/workflow-streams', () => ({ buildTaskCommentAddedPayload: () => ({}), buildTaskCommentUpdatedPayload: () => ({}) }));
      vi.doMock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: async () => undefined }));
      vi.doMock('@alga-psa/event-bus/publishers', () => ({ publishEvent: async () => undefined, publishWorkflowEvent: async () => undefined }));
      const { countTaskCommentsBatchWithDb } = await import('@alga-psa/projects/lib/taskComments/taskCommentService');
      const many = await seedL3cProject(db, w.world, 'Large board', Array.from({ length: 1200 }, (_, i) => `Bulk ${i}`));
      // One root comment per task, each in its own thread (thread_id is required, and the thread names its root).
      for (let from = 0; from < many.taskIds.length; from += 300) {
        const batch = many.taskIds.slice(from, from + 300).map(taskId => ({ taskId, threadId: randomUUID(), commentId: randomUUID() }));
        await db('comment_threads').insert(batch.map(row => ({ tenant: w.world.customer, thread_id: row.threadId, project_task_id: row.taskId, root_comment_id: row.commentId, is_internal: true })));
        await db('project_task_comments').insert(batch.map(row => ({
          tenant: w.world.customer, task_comment_id: row.commentId, task_id: row.taskId, thread_id: row.threadId, user_id: w.world.customerStaff.userId,
          note: '[]', author_type: 'internal',
        })));
      }
      const counts = await countTaskCommentsBatchWithDb(db, w.world.customer, many.taskIds);
      expect(Object.keys(counts)).toHaveLength(1200);
      expect(many.taskIds.every(id => counts[id] === 1)).toBe(true);
      // The access module must not slice, chunk or cap the ids it is handed.
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(require.resolve('../../../../../packages/projects/src/lib/taskComments/taskCommentAuthorization.ts'), 'utf8');
      expect(source).not.toMatch(/\b1000\b|\.slice\(0,/);
    }, 120_000);
    // Main's whole-resource task denial: when the relationship redacts `tasks`/`project_tasks`, the shared task is
    // not-found for the sponsor, so there is no conversation to read, write or offer audiences for.
    describe.each(['tasks', 'project_tasks'])('whole-task redaction (%s)', alias => {
      const setRedactions = (fields: string[]) =>
        db('co_management_relationships').where({ tenant: w.world.customer, relationship_id: w.world.relationshipId }).update({ redacted_fields: fields });
      it('gives not-found for read, write and write audiences, and writes nothing', async () => {
        const { getCoManagedProjectTaskConversation, mutateCoManagedProjectTaskComment, getCoManagedProjectTaskWriteAudiences } = await conversation();
        const { isCoManagedSharedWorkError } = await import('@alga-psa/co-managed/sharedWorkIdentity');
        const before = Number((await db('project_task_comments').where({ tenant: w.world.customer, task_id: w.taskId }).count('* as n').first())!.n);
        await setRedactions([alias]);
        try {
          await expect(getCoManagedProjectTaskConversation(db, w.techActor, w.resource)).rejects.toSatisfy(isCoManagedSharedWorkError);
          await expect(mutateCoManagedProjectTaskComment(db, w.techActor, w.resource,
            { operationId: randomUUID(), kind: 'create', audience: 'shared_it', ...text('blocked') } as any)).rejects.toSatisfy(isCoManagedSharedWorkError);
          expect(await getCoManagedProjectTaskWriteAudiences(db, w.techActor, w.resource)).toEqual([]);
        } finally { await setRedactions([]); }
        expect(Number((await db('project_task_comments').where({ tenant: w.world.customer, task_id: w.taskId }).count('* as n').first())!.n)).toBe(before);
      });
    });
  });
}
