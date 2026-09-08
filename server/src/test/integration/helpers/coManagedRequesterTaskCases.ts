import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import { createRequesterTaskComment, getRequesterTaskConversation, downloadRequesterTaskAttachment } from '../../../../../packages/co-managed/src/requesterTaskConversation';
import { mutateCoManagedProjectTaskComment } from '../../../../../packages/co-managed/src/projectTaskConversation';
import { uploadCoManagedConversationAttachment } from '../../../../../packages/co-managed/src/conversationAttachments';

export async function withCoManagedRequesterTaskFixture(getDb: () => Knex, withTask: (work: (f: any) => Promise<void>) => Promise<void>, work: (f: any) => Promise<void>) {
    await withTask(async f => {
      const db = getDb(), tenant = f.actor.tenant, userId = randomUUID(), sessionId = randomUUID();
      const contact = await f.customer.table('contacts').where('client_id', f.operation.customer_client_id).first();
      await f.customer.table('users').insert({ tenant, user_id: userId, username: `requester-${userId}`, email: `${userId}@example.test`,
        first_name: 'Portal', last_name: 'Requester', hashed_password: 'not-a-login', user_type: 'client', contact_id: contact.contact_name_id, is_inactive: false });
      const role = await f.customer.table('roles').where({ role_name: 'User', client: true }).first();
      await f.customer.table('user_roles').insert({ tenant, user_id: userId, role_id: role.role_id });
      await f.customer.table('sessions').insert({ tenant, user_id: userId, session_id: sessionId, expires_at: new Date(Date.now() + 3600000) });
      await f.customer.table('projects').where('project_id', f.project.project_id).update({ client_portal_config: { show_tasks: true, visible_task_fields: ['task_name'] } });
      const actor = { kind: 'session' as const, tenant, userId, sessionId }, target = { projectId: f.project.project_id, taskId: f.resource.id };
      const create = (text: string, extra = {}) => createRequesterTaskComment(db, actor, target, { operationId: randomUUID(), text, ...extra });
      const message = (audience: 'requester' | 'shared_it' | 'organization_private', principal = f.customerPrincipal) =>
        mutateCoManagedProjectTaskComment(db, principal, f.resource, { operationId: randomUUID(), kind: 'create', text: `${audience} body`, audience });
      await work({ ...f, db, portal: actor, target, create, message, contact });
    });
}

export function registerCoManagedRequesterTaskCases(getDb: () => Knex, withTask: (work: (f: any) => Promise<void>) => Promise<void>) {
  const fixture = (work: (f: any) => Promise<void>) => withCoManagedRequesterTaskFixture(getDb, withTask, work);
  it('requester task conversation shows only explicit requester threads and persists idempotent portal replies with durable events', async () => fixture(async f => {
    const visible = await f.message('requester', f.principal);
    const shared = await f.message('shared_it'), local = await f.message('organization_private');
    await f.message('organization_private', f.principal);
    const initial = await getRequesterTaskConversation(f.db, f.portal, f.target);
    expect(initial.items.map(row => row.commentId)).toEqual([visible.commentId]);
    expect(initial.items[0].authorName).toBeTruthy();
    expect(initial.canWrite).toBe(true);
    for (const hidden of [shared, local]) await expect(f.create('cannot reply', { parent: { threadId: hidden.threadId, commentId: hidden.commentId } })).rejects.toThrow();
    const request = { operationId: randomUUID(), text: '<literal request>', parent: { threadId: visible.threadId, commentId: visible.commentId } };
    const results = await Promise.all([createRequesterTaskComment(f.db, f.portal, f.target, request), createRequesterTaskComment(f.db, f.portal, f.target, request)]);
    expect(results[0]).toEqual(results[1]);
    const row = await f.customer.table('project_task_comments').where('task_comment_id', request.operationId).first();
    expect(row).toMatchObject({ author_type: 'client', user_id: f.portal.userId, actor_reference_id: null, collaboration_revision: 1 });
    expect(JSON.parse(row.note)[0].content[0].text).toBe('<literal request>');
    expect(await f.customer.table('co_management_event_outbox').where('event_id', request.operationId)).toHaveLength(1);
    await expect(createRequesterTaskComment(f.db, f.portal, f.target, { ...request, text: 'different' })).rejects.toThrow('already used');
  }));
  it.each(['company', 'project', 'visibility', 'role', 'session', 'contact'])('requester task conversation denies current %s authority before content or transport', async reason => fixture(async f => {
    const visible = await f.message('requester'), download = vi.fn();
    if (reason === 'company') await f.customer.table('contacts').where('contact_name_id', f.contact.contact_name_id).update({ client_id: null });
    if (reason === 'project') f.target.projectId = randomUUID();
    if (reason === 'visibility') await f.customer.table('projects').where('project_id', f.project.project_id).update({ client_portal_config: { show_tasks: false } });
    if (reason === 'role') await f.customer.table('user_roles').where('user_id', f.portal.userId).delete();
    if (reason === 'session') await f.customer.table('sessions').where('session_id', f.portal.sessionId).update({ revoked_at: new Date() });
    if (reason === 'contact') await f.customer.table('contacts').where('contact_name_id', f.contact.contact_name_id).update({ is_inactive: true });
    await expect(getRequesterTaskConversation(f.db, f.portal, f.target)).rejects.toThrow();
    await expect(f.create('blocked')).rejects.toThrow();
    await expect(downloadRequesterTaskAttachment(f.db, f.portal, f.target, { threadId: visible.threadId, commentId: visible.commentId }, randomUUID(), download)).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  }));
  it('requester task conversation preserves local history and inherited file bytes after relationship termination', async () => fixture(async f => {
    const visible = await f.message('requester'), privateMessage = await f.message('organization_private');
    const bytes = Buffer.from('requester task file'), attachmentId = randomUUID();
    await uploadCoManagedConversationAttachment(f.db, f.customerPrincipal, f.resource, { attachmentId,
      comment: { storeTenant: f.portal.tenant, threadId: visible.threadId, commentId: visible.commentId }, fileName: 'request.txt', mimeType: 'text/plain', content: bytes }, async () => {});
    await f.customer.table('co_management_relationships').where('relationship_id', f.resource.relationshipId).update({ state: 'terminated', ended_at: new Date() });
    const screen = await getRequesterTaskConversation(f.db, f.portal, f.target);
    expect(screen.canWrite).toBe(false);
    expect(screen.items[0].attachments.map(row => row.attachmentId)).toEqual([attachmentId]);
    const download = vi.fn(async () => bytes);
    const file = await downloadRequesterTaskAttachment(f.db, f.portal, f.target, { threadId: visible.threadId, commentId: visible.commentId }, attachmentId, download);
    expect(Buffer.from(file.content)).toEqual(bytes);
    await expect(downloadRequesterTaskAttachment(f.db, f.portal, f.target, { threadId: privateMessage.threadId, commentId: privateMessage.commentId }, attachmentId, download)).rejects.toThrow();
    expect(download).toHaveBeenCalledTimes(1);
    await expect(f.create('read only')).rejects.toThrow();
  }));
  it('requester task conversation pages before returning private counts and rejects replies to a deleted root', async () => fixture(async f => {
    const root = await f.create('root');
    for (let i = 0; i < 26; i++) await f.create(`reply ${i}`, { parent: { threadId: root.threadId, commentId: root.commentId } });
    await f.message('organization_private');
    const page = await getRequesterTaskConversation(f.db, f.portal, f.target);
    expect(page.items).toHaveLength(25);
    const older = await getRequesterTaskConversation(f.db, f.portal, f.target, page.nextBefore!);
    expect(older.items).toHaveLength(2);
    expect(new Set([...page.items, ...older.items].map(row => row.commentId)).size).toBe(27);
    await f.customer.table('project_task_comments').where('task_comment_id', root.commentId).update({ deleted_at: new Date() });
    await expect(f.create('late reply', { parent: { threadId: root.threadId, commentId: page.items[0].commentId } })).rejects.toThrow();
    const retained = await getRequesterTaskConversation(f.db, f.portal, f.target);
    expect(retained.items[0].canReply).toBe(false);
    expect(retained.items[0].note).toBeTruthy();
  }));
}
