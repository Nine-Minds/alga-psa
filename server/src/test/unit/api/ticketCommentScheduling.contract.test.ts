import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTicketCommentSchema } from '../../../lib/api/schemas/ticket';

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

function addCommentBody(): string {
  const source = readSource('../../../lib/api/services/TicketService.ts');
  const start = source.indexOf('async addComment(');
  const end = source.indexOf('async cancelScheduledComment(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

describe('Ticket comment scheduling contract', () => {
  it('accepts a future client-visible comment with an IANA zone', () => {
    const parsed = createTicketCommentSchema.safeParse({
      comment_text: 'Following up tomorrow morning',
      scheduled_publish_at: future,
      scheduled_publish_tz: 'America/New_York',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects scheduling in the past, on internal comments, or without a valid zone', () => {
    const base = { comment_text: 'x', scheduled_publish_tz: 'America/New_York' };
    const pastResult = createTicketCommentSchema.safeParse({ ...base, scheduled_publish_at: past });
    expect(pastResult.success).toBe(false);

    const internalResult = createTicketCommentSchema.safeParse({ ...base, scheduled_publish_at: future, is_internal: true });
    expect(internalResult.success).toBe(false);

    const noTz = createTicketCommentSchema.safeParse({ comment_text: 'x', scheduled_publish_at: future });
    expect(noTz.success).toBe(false);

    const badTz = createTicketCommentSchema.safeParse({ comment_text: 'x', scheduled_publish_at: future, scheduled_publish_tz: 'Mars/Olympus' });
    expect(badTz.success).toBe(false);

    const tzOnly = createTicketCommentSchema.safeParse({ comment_text: 'x', scheduled_publish_tz: 'UTC' });
    expect(tzOnly.success).toBe(false);
  });

  it('withholds publication for scheduled comments and arms the same job the web composer uses', () => {
    const body = addCommentBody();

    expect(body).toContain('const scheduledPublication = resolveScheduledCommentPublication(data, apiIsInternal);');
    expect(body).toContain("publish_state: 'scheduled',");
    // No client-reply side effects and no TICKET_COMMENT_ADDED until the job publishes it.
    expect(body).toContain('if (!comment.is_internal && !scheduledPublication) {');
    expect(body).toContain('registerAfterCommit(trx, async () => {');
    expect(body).toContain('scheduleBackgroundJobAt(\n            SCHEDULED_COMMENT_JOB,');
    expect(body).toContain('singletonKey: `publish-comment:${comment.comment_id}`');
    expect(body).toContain(".update({ schedule_job_id: scheduled.jobId });");
    expect(body).toContain("} else {\n        await persistCommentPublication(trx, { eventType: 'TICKET_COMMENT_ADDED', payload: eventPayload }, publishEvent);");

    const service = readSource('../../../lib/api/services/TicketService.ts');
    expect(service).toContain("const SCHEDULED_COMMENT_JOB = 'publish-scheduled-comment';");
  });

  it('cancels via a compare-and-set on publish_state and withdraws attachments and the job', () => {
    const service = readSource('../../../lib/api/services/TicketService.ts');
    const start = service.indexOf('async cancelScheduledComment(');
    const body = service.slice(start, service.indexOf('async updateComment(', start));

    expect(body).toContain("if (existing.publish_state !== 'scheduled') {");
    expect(body).toContain(".where({ comment_id: commentId, publish_state: 'scheduled' })");
    expect(body).toContain("publish_state: 'canceled',");
    expect(body).toContain('await withdrawCommentAttachments(trx, context.tenant, commentId);');
    expect(body).toContain('await cancelScheduledJob(existing.schedule_job_id, context.tenant);');
    expect(body).toContain("eventType: 'TICKET_COMMENT_SCHEDULE_CANCELED',");
  });

  it('exposes cancellation on DELETE /comments/{commentId}/schedule and documents it', () => {
    const route = readSource('../../../app/api/v1/tickets/[id]/comments/[commentId]/schedule/route.ts');
    expect(route).toContain('DELETE /api/v1/tickets/{id}/comments/{commentId}/schedule');
    expect(route).toContain('export const DELETE = controller.cancelScheduledComment();');

    const openapi = readSource('../../../lib/api/openapi/routes/workManagementV1.ts');
    expect(openapi).toContain("method: 'delete', path: '/api/v1/tickets/{id}/comments/{commentId}/schedule'");
    expect(openapi).toContain('scheduled_publish_at: zOpenApi.string().datetime({ offset: true }).optional()');
  });
});
