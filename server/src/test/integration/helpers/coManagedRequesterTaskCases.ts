/**
 * CM L4c: the requester task thread. A portal contact replies on a shared task without gaining internal
 * visibility, and the row they write is authored by a CONTACT (no user, no actor reference).
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureL3cDbEnv, connectL3cDb, cleanupL3cTenants, seedL3cProject } from './coManagedL3cFixture';
import { seedL4cWorld, type L4cWorld } from './coManagedTaskDisclosureCases';

interface Portal { userId: string; sessionId: string; contactId: string }

async function grant(db: Knex, tenant: string, roleId: string, resource: string, action: string) {
  let permission = await db('permissions').where({ tenant, resource, action, client: true }).first();
  if (!permission) {
    permission = { tenant, permission_id: randomUUID(), resource, action, msp: false, client: true };
    await db('permissions').insert(permission);
  }
  await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id });
}

/** A client-portal login for a contact of the customer company, with its own client role. */
async function addPortalUser(db: Knex, w: L4cWorld, options: { permissions?: Array<[string, string]>; clientId?: string } = {}): Promise<Portal> {
  const tenant = w.world.customer, userId = randomUUID(), contactId = randomUUID(), sessionId = randomUUID(), roleId = randomUUID();
  await db('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Pat Requester', email: `${contactId.slice(0, 8)}@example.com`, client_id: options.clientId ?? w.world.customerClientId });
  await db('users').insert({ tenant, user_id: userId, username: `portal-${userId.slice(0, 8)}`, email: `${userId.slice(0, 8)}@example.com`, first_name: 'Pat', last_name: 'Requester',
    hashed_password: 'x', user_type: 'client', contact_id: contactId });
  await db('roles').insert({ tenant, role_id: roleId, role_name: `Portal ${roleId.slice(0, 6)}`, msp: false, client: true });
  await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  for (const [resource, action] of options.permissions ?? [['project', 'read'], ['project_task_comment', 'create']]) await grant(db, tenant, roleId, resource, action);
  await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, created_at: db.fn.now(), expires_at: db.raw("now() + interval '1 day'") });
  return { userId, sessionId, contactId };
}

export function registerCoManagedRequesterTaskCases() {
  describe('CM L4c requester task thread', () => {
    let db: Knex, w: L4cWorld, portal: Portal;
    const actorOf = (p: Portal) => ({ kind: 'session' as const, tenant: w.world.customer, userId: p.userId, sessionId: p.sessionId });
    const target = () => ({ projectId: w.project.projectId, taskId: w.taskId });
    const requester = () => import('@alga-psa/co-managed/requesterTaskConversation');

    beforeAll(async () => {
      vi.doMock('@alga-psa/core/secrets', () => ({
        getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
        getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
      }));
      configureL3cDbEnv();
      db = await connectL3cDb();
      w = await seedL4cWorld(db);
      await db('projects').where({ tenant: w.world.customer, project_id: w.project.projectId }).update({ client_portal_config: JSON.stringify({ show_tasks: true }) });
      portal = await addPortalUser(db, w);
    }, 180_000);
    afterAll(async () => {
      await cleanupL3cTenants(w?.world.tenants ?? []);
      await db?.destroy().catch(() => undefined);
    });

    it('a reply is authored by the contact: no user, no actor reference, a requester (non-internal) thread', async () => {
      const { createRequesterTaskComment } = await requester();
      const operationId = randomUUID();
      const created = await createRequesterTaskComment(db, actorOf(portal), target(), { operationId, text: 'Can you check this?' });
      const row = await db('project_task_comments').where({ tenant: w.world.customer, task_comment_id: created.commentId }).first();
      expect(row).toMatchObject({ user_id: null, actor_reference_id: null, contact_id: portal.contactId, author_kind: 'contact', author_type: 'client',
        actor_display_name: 'Pat Requester', actor_organization_name: 'Customer Co', collaboration_revision: 1 });
      const thread = await db('comment_threads').where({ tenant: w.world.customer, thread_id: row.thread_id }).first();
      expect(thread).toMatchObject({ collaboration_audience: 'requester', is_internal: false, project_task_id: w.taskId, ticket_id: null });
    });

    it('the contact sees requester threads only, never shared-IT or organization-private ones', async () => {
      const { getRequesterTaskConversation } = await requester();
      const { mutateCoManagedProjectTaskComment } = await import('@alga-psa/co-managed/projectTaskConversation');
      const body = (text: string) => ({ document: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] });
      const marker = randomUUID();
      for (const audience of ['requester', 'shared_it', 'organization_private'] as const) {
        await mutateCoManagedProjectTaskComment(db, w.techActor, w.resource, { operationId: randomUUID(), kind: 'create', audience, ...body(`${audience}-${marker}`) } as any);
      }
      const { items, canWrite } = await getRequesterTaskConversation(db, actorOf(portal), target());
      const notes = items.map(item => item.note ?? '');
      expect(canWrite).toBe(true);
      expect(notes.some(n => n.includes(`requester-${marker}`))).toBe(true);
      expect(notes.some(n => n.includes(`shared_it-${marker}`) || n.includes(`organization_private-${marker}`))).toBe(false);
      const own = items.find(item => item.authorName === 'Pat Requester');
      expect(own).toMatchObject({ authorKind: 'contact', isOwn: true });
      expect(items.find(item => (item.note ?? '').includes(`requester-${marker}`))).toMatchObject({ authorKind: 'user', isOwn: false });
    });

    it('is idempotent on the operation id and refuses a changed payload under the same id', async () => {
      const { createRequesterTaskComment, RequesterTaskCommentConflict } = await requester();
      const operationId = randomUUID();
      const first = await createRequesterTaskComment(db, actorOf(portal), target(), { operationId, text: 'once' });
      expect(await createRequesterTaskComment(db, actorOf(portal), target(), { operationId, text: 'once' })).toEqual(first);
      await expect(createRequesterTaskComment(db, actorOf(portal), target(), { operationId, text: 'twice' })).rejects.toBeInstanceOf(RequesterTaskCommentConflict);
      expect(Number((await db('project_task_comments').where({ tenant: w.world.customer, task_comment_id: operationId }).count('* as n').first())!.n)).toBe(1);
    });

    it('replies stay in the requester thread; a parent in an internal thread is refused', async () => {
      const { createRequesterTaskComment } = await requester();
      const { mutateCoManagedProjectTaskComment } = await import('@alga-psa/co-managed/projectTaskConversation');
      const root = await createRequesterTaskComment(db, actorOf(portal), target(), { operationId: randomUUID(), text: 'root' });
      const reply = await createRequesterTaskComment(db, actorOf(portal), target(), { operationId: randomUUID(), text: 'reply', parent: { threadId: root.threadId, commentId: root.commentId } });
      expect(reply.threadId).toBe(root.threadId);
      expect((await db('comment_threads').where({ tenant: w.world.customer, thread_id: root.threadId }).first()).reply_count).toBe(1);
      const internal = await mutateCoManagedProjectTaskComment(db, w.techActor, w.resource, { operationId: randomUUID(), kind: 'create', audience: 'shared_it',
        document: [{ type: 'paragraph', content: [{ type: 'text', text: 'internal', styles: {} }] }] } as any);
      await expect(createRequesterTaskComment(db, actorOf(portal), target(), { operationId: randomUUID(), text: 'sneak',
        parent: { threadId: internal.threadId, commentId: internal.commentId } })).rejects.toThrow();
    });

    describe('denials', () => {
      it('a contact of another company', async () => {
        const { getRequesterTaskConversation, createRequesterTaskComment } = await requester();
        const otherClient = randomUUID();
        await db('clients').insert({ tenant: w.world.customer, client_id: otherClient, client_name: 'Other Co' });
        const stranger = await addPortalUser(db, w, { clientId: otherClient });
        await expect(getRequesterTaskConversation(db, actorOf(stranger), target())).rejects.toThrow();
        await expect(createRequesterTaskComment(db, actorOf(stranger), target(), { operationId: randomUUID(), text: 'no' })).rejects.toThrow();
      });
      it('a project whose portal config hides tasks', async () => {
        const { getRequesterTaskConversation } = await requester();
        const hidden = await seedL3cProject(db, w.world, 'Hidden tasks', ['Quiet']);
        await db('projects').where({ tenant: w.world.customer, project_id: hidden.projectId }).update({ client_portal_config: JSON.stringify({ show_tasks: false }) });
        await expect(getRequesterTaskConversation(db, actorOf(portal), { projectId: hidden.projectId, taskId: hidden.taskIds[0] })).rejects.toThrow();
      });
      it('a task that is not in the named project', async () => {
        const { getRequesterTaskConversation } = await requester();
        const other = await seedL3cProject(db, w.world, 'Other project', ['Elsewhere']);
        await db('projects').where({ tenant: w.world.customer, project_id: other.projectId }).update({ client_portal_config: JSON.stringify({ show_tasks: true }) });
        await expect(getRequesterTaskConversation(db, actorOf(portal), { projectId: w.project.projectId, taskId: other.taskIds[0] })).rejects.toThrow();
      });
      it('a role without project:read, and a role that cannot comment (read ok, write denied)', async () => {
        const { getRequesterTaskConversation, createRequesterTaskComment } = await requester();
        const none = await addPortalUser(db, w, { permissions: [] });
        await expect(getRequesterTaskConversation(db, actorOf(none), target())).rejects.toThrow();
        const readOnly = await addPortalUser(db, w, { permissions: [['project', 'read']] });
        expect((await getRequesterTaskConversation(db, actorOf(readOnly), target())).canWrite).toBe(false);
        await expect(createRequesterTaskComment(db, actorOf(readOnly), target(), { operationId: randomUUID(), text: 'no' })).rejects.toThrow();
      });
      it('a revoked or unknown session, and an internal (non-client) user', async () => {
        const { getRequesterTaskConversation } = await requester();
        const revoked = await addPortalUser(db, w);
        await db('sessions').where({ tenant: w.world.customer, session_id: revoked.sessionId }).update({ revoked_at: db.fn.now() });
        await expect(getRequesterTaskConversation(db, actorOf(revoked), target())).rejects.toThrow();
        await expect(getRequesterTaskConversation(db, { ...actorOf(portal), sessionId: randomUUID() }, target())).rejects.toThrow();
        await expect(getRequesterTaskConversation(db, w.customerActor, target())).rejects.toThrow();
      });
      it('malformed input never reaches the database', async () => {
        const { createRequesterTaskComment } = await requester();
        await expect(createRequesterTaskComment(db, actorOf(portal), target(), { operationId: 'nope', text: 'x' })).rejects.toThrow();
        await expect(createRequesterTaskComment(db, actorOf(portal), target(), { operationId: randomUUID(), text: 'x', userId: 'u' } as any)).rejects.toThrow();
      });
    });
  });
}
