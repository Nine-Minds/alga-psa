import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import * as dbModule from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createCommentRecoveryScheduleDiscovery } from '@/lib/jobs/commentRecoveryScheduleDiscovery';
import { reconcileScheduledCommentPublications } from '@/lib/jobs/handlers/publishScheduledCommentHandler';
import { persistCommentPublication } from '@shared/lib/ticketCommentAttachments';
import { StorageService } from '@alga-psa/storage/StorageService';

// Required migrated-database coverage; every fixture rolls back.
describe('comment recovery schedule discovery (PostgreSQL)', () => {
  let conn: Knex, trx: Knex.Transaction;
  beforeAll(async () => {
    conn = await createTestDbConnection();
  });
  beforeEach(async () => { trx = await conn.transaction(); vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx); });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await trx.rollback(); });
  afterAll(async () => { await conn.destroy(); });

  async function tenantWithPendingComment() {
    const tenant = randomUUID(), user = randomUUID(), ticket = randomUUID(), comment = randomUUID(), thread = randomUUID();
    await trx('tenants').insert({ tenant, client_name: 'Recovery discovery test', email: 'controlled@example.test', product_code: 'psa' });
    const table = (name: string) => dbModule.tenantDb(trx, tenant).table(name);
    await table('users').insert({ tenant, user_id: user, username: user, email: 'controlled@example.test', hashed_password: 'unused', user_type: 'internal', is_inactive: false });
    const client = randomUUID();
    await table('clients').insert({ tenant, client_id: client, client_name: 'Recovery client' });
    await table('tickets').insert({ tenant, client_id: client, ticket_id: ticket, ticket_number: 'RECOVERY-TEST', title: 'Recovery test', entered_by: user });
    await table('comment_threads').insert({ tenant, thread_id: thread, ticket_id: ticket, root_comment_id: comment, is_internal: false, created_by: user });
    await table('comments').insert({ tenant, comment_id: comment, thread_id: thread, ticket_id: ticket, user_id: user, author_type: 'internal', note: '[]', is_internal: false, is_resolution: false });
    await persistCommentPublication(trx, { payload: { tenantId: tenant, ticketId: ticket, commentId: comment, userId: user, comment: { id: comment, content: '[]', isInternal: false } } });
    // A missing document is already physically gone; recovery should complete its expired tombstone.
    const attachment = randomUUID();
    await table('ticket_comment_attachments').insert({ tenant, attachment_id: attachment, ticket_id: ticket, document_id: randomUUID(), created_by: user, expires_at: new Date(0) });
    return { tenant, comment, attachment, table };
  }

  it('discovers a tenant created after startup, installs once, and recovers its publication and abandoned draft', async () => {
    const schedules = new Map<string, { tenantId: string }>();
    const schedule = vi.fn(async (_name: string, data: { tenantId: string }, _cron: string, options: any) => { schedules.set(options.singletonKey, data); return { jobId: randomUUID() }; });
    const runner = { scheduleRecurringJob: schedule } as any;
    const discovery = createCommentRecoveryScheduleDiscovery(async () => runner);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await discovery.start();
      const fixture = await tenantWithPendingComment();
      expect(schedules.has(`recover-comment-publications:${fixture.tenant}`)).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      await discovery.tick();
      const job = schedules.get(`recover-comment-publications:${fixture.tenant}`)!;
      expect(job).toEqual({ tenantId: fixture.tenant });
      await vi.advanceTimersByTimeAsync(60_000); await discovery.tick();
      expect(schedule.mock.calls.filter(call => call[1].tenantId === fixture.tenant)).toHaveLength(1);
      const factory = await import('@/lib/jobs/JobRunnerFactory');
      vi.spyOn(factory, 'getJobRunner').mockResolvedValue(runner);
      const publishers = await import('@alga-psa/event-bus/publishers');
      const publish = vi.spyOn(publishers, 'publishStoredWorkflowEvent').mockResolvedValue(undefined);
      await reconcileScheduledCommentPublications(false, job.tenantId);
      expect((await fixture.table('comments').where({ comment_id: fixture.comment }).first()).scheduled_publish_dispatched_at).toBeTruthy();
      expect((await fixture.table('ticket_comment_attachments').where({ attachment_id: fixture.attachment }).first()).cleanup_completed_at).toBeTruthy();
      expect(publish).toHaveBeenCalledOnce();
    } finally { discovery.stop(); }
  });

  it('retries scheduler initialization and partial installation, keeping successful tenants idempotent', async () => {
    const fixture = await tenantWithPendingComment();
    const schedules = new Map<string, string>();
    let failInstall = true;
    const schedule = vi.fn(async (_name: string, data: { tenantId: string }, _cron: string, options: any) => {
      schedules.set(options.singletonKey, data.tenantId); // scheduler accepted before the connection failed
      if (data.tenantId === fixture.tenant && failInstall) { failInstall = false; throw new Error('Connection lost after schedule creation'); }
      return { jobId: randomUUID() };
    });
    const runner = { scheduleRecurringJob: schedule } as any;
    const getRunner = vi.fn().mockRejectedValueOnce(new Error('Scheduler unavailable')).mockResolvedValue(runner);
    const discovery = createCommentRecoveryScheduleDiscovery(getRunner);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await discovery.start();
      expect(schedule).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000); await discovery.tick();
      await vi.advanceTimersByTimeAsync(60_000); await discovery.tick();
      await vi.advanceTimersByTimeAsync(60_000); await discovery.tick();
      expect(schedule.mock.calls.filter(call => call[1].tenantId === fixture.tenant)).toHaveLength(2);
      expect([...schedules.values()].filter(tenant => tenant === fixture.tenant)).toHaveLength(1);
      const publishers = await import('@alga-psa/event-bus/publishers');
      vi.spyOn(publishers, 'publishStoredWorkflowEvent').mockResolvedValue(undefined);
      const factory = await import('@/lib/jobs/JobRunnerFactory');
      vi.spyOn(factory, 'getJobRunner').mockResolvedValue(runner);
      await reconcileScheduledCommentPublications(false, fixture.tenant);
      expect((await fixture.table('comments').where({ comment_id: fixture.comment }).first()).scheduled_publish_dispatched_at).toBeTruthy();
      expect((await fixture.table('ticket_comment_attachments').where({ attachment_id: fixture.attachment }).first()).cleanup_completed_at).toBeTruthy();
    } finally { discovery.stop(); }
  });

  it('discovers and physically cleans an expired Project Task draft without ticket activity', async () => {
    const tenant = randomUUID(), user = randomUUID(), task = randomUUID();
    const file = randomUUID(), thumbnail = randomUUID(), document = randomUUID();
    await trx('tenants').insert({ tenant, client_name: 'Task draft cleanup discovery', email: 'task-cleanup@example.test', product_code: 'psa' });
    const table = (name: string) => dbModule.tenantDb(trx, tenant).table(name);
    await table('users').insert({ tenant, user_id: user, username: user, email: 'task-cleanup@example.test', hashed_password: 'unused', user_type: 'internal', is_inactive: false });
    await table('external_files').insert({ tenant, file_id: file, file_name: 'expired.png', original_name: 'expired.png', mime_type: 'image/png', file_size: 8, storage_path: `task-cleanup/${file}`, uploaded_by_id: user });
    await table('external_files').insert({ tenant, file_id: thumbnail, file_name: 'thumb.png', original_name: 'thumb.png', mime_type: 'image/png', file_size: 4, storage_path: `task-cleanup/${thumbnail}`, uploaded_by_id: user });
    await table('documents').insert({ tenant, document_id: document, document_name: 'expired.png', file_id: file, thumbnail_file_id: thumbnail, mime_type: 'image/png', file_size: 8, user_id: user, created_by: user, is_client_visible: true });
    await table('document_associations').insert({ tenant, document_id: document, entity_type: 'project_task', entity_id: task });
    await table('comment_attachment_drafts').insert({ tenant, entity_type: 'project_task', entity_id: task, document_id: document, file_id: file, created_by: user, state: 'draft', expires_at: new Date(0) });
    const remove = vi.spyOn(StorageService, 'deleteFile').mockImplementation(async () => undefined as any);
    const factory = await import('@/lib/jobs/JobRunnerFactory');
    vi.spyOn(factory, 'getJobRunner').mockResolvedValue({} as any);

    await reconcileScheduledCommentPublications(false, tenant);

    expect(remove).toHaveBeenCalledWith(file, user, expect.anything());
    expect(remove).toHaveBeenCalledWith(thumbnail, user, expect.anything());
    expect(await table('documents').where({ document_id: document }).first()).toBeUndefined();
    expect((await table('comment_attachment_drafts').where({ document_id: document }).first()).cleanup_completed_at).toBeTruthy();
    expect(await table('ticket_comment_attachments').where({ tenant })).toHaveLength(0);
  });
});
