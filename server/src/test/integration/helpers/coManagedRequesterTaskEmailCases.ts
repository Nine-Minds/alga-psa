import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import { withCoManagedRequesterTaskFixture } from './coManagedRequesterTaskCases';
import { enqueueCoManagedRequesterTaskEmailDeliveries } from '../../../../../packages/co-managed/src/requesterTaskEmail';
import { processCoManagedRequesterEmailDeliveries } from '../../../../../packages/co-managed/src/requesterEmailDeliveries';
import { consumeCoManagedConversationEvent } from '../../../../../packages/co-managed/src/conversationEventConsumers';
import { createRequesterTaskComment } from '../../../../../packages/co-managed/src/requesterTaskConversation';
import { mutateCoManagedProjectTaskComment } from '../../../../../packages/co-managed/src/projectTaskConversation';
const TABLE = 'co_management_requester_email_deliveries';
export function registerCoManagedRequesterTaskEmailCases(getDb: () => Knex, withTask: (work: (f: any) => Promise<void>) => Promise<void>) {
  const fixture = (work: (f: any) => Promise<void>) => withCoManagedRequesterTaskFixture(getDb, withTask, async f => {
    await f.customer.table('projects').where('project_id', f.target.projectId).update({ contact_name_id: f.contact.contact_name_id });
    await work(f);
  });
  async function eventFor(f: any, comment: any) {
    const row = await f.customer.table('co_management_event_outbox').where('comment_id', comment.commentId).first();
    return { id: row.event_id, eventType: row.event_type, timestamp: new Date().toISOString(), payload: row.publication.payload };
  }
  async function enqueue(f: any, comment: any) {
    const event = await eventFor(f, comment);
    expect(await consumeCoManagedConversationEvent(f.db, event, 'requester-email', async (trx, publication) => {
      await enqueueCoManagedRequesterTaskEmailDeliveries(trx, { ownerTenant: f.portal.tenant, taskId: publication.payload.taskId,
        commentId: publication.payload.taskCommentId, eventId: event.id });
    })).toBe(true);
    return event;
  }
  async function addPortal(f: any) {
    const userId = randomUUID(), contactId = randomUUID(), sessionId = randomUUID();
    await f.customer.table('contacts').insert({ ...f.contact, contact_name_id: contactId, full_name: 'Other requester', email: `${userId}@example.test` });
    const user = await f.customer.table('users').where('user_id', f.portal.userId).first();
    await f.customer.table('users').insert({ ...user, user_id: userId, contact_id: contactId, username: `other-${userId}`, email: `${userId}@example.test` });
    const role = await f.customer.table('user_roles').where('user_id', f.portal.userId).first();
    await f.customer.table('user_roles').insert({ tenant: f.portal.tenant, user_id: userId, role_id: role.role_id });
    await f.customer.table('sessions').insert({ tenant: f.portal.tenant, user_id: userId, session_id: sessionId, expires_at: new Date(Date.now() + 3600000) });
    return { kind: 'session' as const, tenant: f.portal.tenant, userId, sessionId };
  }

  it('requester task email subscriber durably delivers public MSP comments to the project contact without ticket reply tokens', async () => fixture(async f => {
    await expect(createRequesterTaskComment(f.db, { ...f.portal, kind: 'requester_task_recipient' } as any, f.target,
      { operationId: randomUUID(), text: 'A mail recipient cannot write' })).rejects.toThrow();
    const comment = await f.message('requester', f.principal), event = await eventFor(f, comment);
    const transport = await import('@alga-psa/jobs/handlers/coManagedCommentEmailTransport');
    const send = vi.spyOn(transport, 'sendCoManagedRequesterCommentEmail').mockResolvedValue({ status: 'delivered' });
    try {
      const { handleCoManagedRequesterTaskCommentEmailEvent } = await import('../../../lib/eventBus/subscribers/coManagedRequesterCommentEmailSubscriber');
      expect(await handleCoManagedRequesterTaskCommentEmailEvent(event as any, f.db)).toBe(true);
      await processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toMatchObject({ tenant: f.portal.tenant, recipient: { kind: 'requester_task_user', userId: f.portal.userId },
        message: { resource: { tenant: f.portal.tenant, kind: 'project_task', id: f.resource.id }, projectId: f.target.projectId, audience: 'requester' } });
      expect(send.mock.calls[0][0]).not.toHaveProperty('replyToken');
      expect(await f.customer.table('co_management_requester_reply_tokens')).toHaveLength(0);
      expect(await f.customer.table('co_management_event_consumers').where({ event_id: event.id, consumer: 'requester-email' }).first()).toMatchObject({ status: 'completed' });
      await handleCoManagedRequesterTaskCommentEmailEvent(event as any, f.db);
      expect(send).toHaveBeenCalledTimes(1); expect(await f.customer.table(TABLE)).toHaveLength(1);
      expect((await f.customer.table(TABLE).first()).delivery_key).toContain(f.portal.tenant);
    } finally { send.mockRestore(); }
  }));

  it('requester task email includes current thread participants but excludes unrelated client users and the author', async () => fixture(async f => {
    const participant = await addPortal(f), unrelated = await addPortal(f), root = await f.create('Question from designated project contact');
    const reply = await createRequesterTaskComment(f.db, participant, f.target, { operationId: randomUUID(), text: 'I am involved', parent: { threadId: root.threadId, commentId: root.commentId } });
    await enqueue(f, reply);
    expect((await f.customer.table(TABLE)).map((row: any) => row.recipient_id)).toEqual([f.portal.userId]);
    const response = await mutateCoManagedProjectTaskComment(f.db, f.principal, f.resource, { operationId: randomUUID(), kind: 'create', text: 'MSP response',
      parent: { storeTenant: f.portal.tenant, threadId: root.threadId, commentId: root.commentId }, expectedAudience: 'requester' });
    await enqueue(f, response);
    const ids = (await f.customer.table(TABLE).where('comment_id', response.commentId)).map((row: any) => row.recipient_id).sort();
    expect(ids).toEqual([f.portal.userId, participant.userId].sort()); expect(ids).not.toContain(unrelated.userId);
  }));

  it.each(['private', 'deleted', 'project_hidden', 'role', 'contact', 'company', 'user_inactive', 'retargeted'] as const)('requester task email suppresses delayed delivery after %s changes', async reason => fixture(async f => {
    const comment = await f.message('requester'), event = await enqueue(f, comment);
    expect(await f.customer.table(TABLE)).toHaveLength(1);
    if (reason === 'private') await f.customer.table('comment_threads').where('thread_id', comment.threadId).update({ collaboration_audience: 'shared_it', is_internal: true });
    if (reason === 'deleted') await f.customer.table('project_task_comments').where('task_comment_id', comment.commentId).update({ deleted_at: new Date() });
    if (reason === 'project_hidden') await f.customer.table('projects').where('project_id', f.target.projectId).update({ client_portal_config: { show_tasks: false } });
    if (reason === 'role') await f.customer.table('user_roles').where('user_id', f.portal.userId).delete();
    if (reason === 'contact') await f.customer.table('contacts').where('contact_name_id', f.contact.contact_name_id).update({ is_inactive: true });
    if (reason === 'company') await f.customer.table('contacts').where('contact_name_id', f.contact.contact_name_id).update({ client_id: null });
    if (reason === 'user_inactive') await f.customer.table('users').where('user_id', f.portal.userId).update({ is_inactive: true });
    if (reason === 'retargeted') { await addPortal(f); await f.customer.table('projects').where('project_id', f.target.projectId).update({ contact_name_id: null }); }
    const send = vi.fn(); await processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send);
    expect(send).not.toHaveBeenCalled(); expect(await f.customer.table(TABLE).where('event_id', event.id).first()).toMatchObject({ status: 'skipped' });
  }));

  it('requester task email never enrolls private threads and keeps local public delivery after relationship departure', async () => fixture(async f => {
    for (const audience of ['shared_it', 'organization_private'] as const) await enqueue(f, await f.message(audience));
    expect(await f.customer.table(TABLE)).toHaveLength(0);
    const publicComment = await f.message('requester'); await enqueue(f, publicComment);
    await f.customer.table('co_management_relationships').where('relationship_id', f.resource.relationshipId).update({ state: 'terminated', ended_at: new Date() });
    await f.customer.table('sessions').where('session_id', f.portal.sessionId).update({ revoked_at: new Date() });
    const send = vi.fn().mockResolvedValue({ status: 'delivered' }); await processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send);
    expect(send).toHaveBeenCalledTimes(1);
  }));

  it('requester task email retries with stable identity and reloaded current content without duplicate concurrent sends', async () => fixture(async f => {
    const comment = await f.message('requester'); await enqueue(f, comment);
    const send = vi.fn().mockResolvedValueOnce({ status: 'failed', retryable: true, errorCode: 'provider_down' }).mockResolvedValue({ status: 'delivered' });
    await processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send);
    const edit = await mutateCoManagedProjectTaskComment(f.db, f.customerPrincipal, f.resource, { operationId: randomUUID(), kind: 'edit', text: 'Current requester body',
      comment: { storeTenant: f.portal.tenant, threadId: comment.threadId, commentId: comment.commentId }, expectedRevision: 1 });
    await f.customer.table(TABLE).where('comment_id', comment.commentId).update({ next_attempt_at: f.db.raw('clock_timestamp()') });
    await Promise.all([processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send), processCoManagedRequesterEmailDeliveries(f.db, f.portal.tenant, send)]);
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0].messageId).toBe(send.mock.calls[0][0].messageId);
    expect(send.mock.calls[1][0].message.note).toContain('Current requester body'); expect(edit).toBeDefined();
  }));
}
