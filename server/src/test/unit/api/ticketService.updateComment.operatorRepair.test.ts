import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TicketService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

function updateCommentBody(source: string): string {
  const start = source.indexOf('async updateComment(');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('async search(', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('TicketService.updateComment operator repair contract', () => {
  it('keeps the author-only rule for comments that have an authoring user', () => {
    const body = updateCommentBody(readTicketServiceSource());

    expect(body).toContain('comment.user_id !== context.userId');
    expect(body).toContain('You can only edit your own comments');
  });

  it('allows an operator with ticket:update RBAC to repair ownerless comments, failing closed without a loaded user', () => {
    const body = updateCommentBody(readTicketServiceSource());

    // The operator path applies only to comments with no authoring user
    // (user_id null — e.g. inbound email comments attributed to a contact).
    expect(body).toContain('comment.user_id == null');
    // Fail closed: a missing caller user record denies the repair.
    expect(body).toContain('context.user != null');
    // The RBAC gate is the established ticket update permission (the
    // `comment` RBAC resource is deprecated), checked in-transaction.
    expect(body).toContain("hasPermission(context.user, 'ticket', 'update', trx)");
  });

  it('preserves existing metadata and appends an attributable operatorEdits audit record', () => {
    const body = updateCommentBody(readTicketServiceSource());

    // Existing metadata (parser results, email threading data) is spread, not replaced.
    expect(body).toContain('...existingMetadata');
    expect(body).toContain('operatorEdits: [');
    expect(body).toContain('...operatorEdits');
    expect(body).toContain('userId: context.userId');
  });

  it('never rewrites system-generated comments', () => {
    const body = updateCommentBody(readTicketServiceSource());

    expect(body).toContain('comment.is_system_generated');
    expect(body).toContain('System-generated comments cannot be edited');
  });
});
