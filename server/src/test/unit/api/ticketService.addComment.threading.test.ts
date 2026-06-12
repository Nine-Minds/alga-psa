import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TicketService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

function addCommentBody(source: string): string {
  const start = source.indexOf('async addComment(');
  expect(start).toBeGreaterThan(-1);
  // updateComment is the next method; bound the slice to addComment only.
  const end = source.indexOf('async updateComment(', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('TicketService.addComment threading contract', () => {
  it('T005: forwards parent_comment_id from validated input into the comment insert', () => {
    const body = addCommentBody(readTicketServiceSource());

    expect(body).toContain('data.parent_comment_id');
    expect(body).toContain('const apiParentCommentId = data.parent_comment_id || null;');
    expect(body).toContain('const apiIsReply = Boolean(apiParentCommentId);');
    // parent_comment_id is persisted on the inserted comment row.
    expect(body).toContain('parent_comment_id: apiParentCommentId,');
  });

  it('T006: a reply inherits the thread root visibility and does NOT force is_internal=false', () => {
    const body = addCommentBody(readTicketServiceSource());

    const replyBranch = body.slice(body.indexOf('if (apiIsReply) {'));

    // Resolves the parent + its thread visibility.
    expect(replyBranch).toContain("'thread.is_internal as thread_is_internal'");
    expect(replyBranch).toContain("'parent.comment_id', apiParentCommentId");
    // Reply visibility is inherited from the thread root, not from data.is_internal.
    expect(replyBranch).toContain('apiIsInternal = Boolean(parent.thread_is_internal);');

    // The reply branch must not derive is_internal from the (schema-defaulted)
    // request body.
    const replyOnly = body.slice(
      body.indexOf('if (apiIsReply) {'),
      body.indexOf('} else {')
    );
    expect(replyOnly).not.toContain('data.is_internal');

    // Reply attaches to the parent's existing thread (no new thread row) and
    // bumps the thread counters.
    expect(replyBranch).toContain('apiThreadId = parent.thread_id;');
    expect(replyBranch).toContain("reply_count: trx.raw('reply_count + 1')");
    expect(replyBranch).toContain('Cannot reply to a deleted comment');
  });

  it('T007: top-level comment (no parent) keeps creating a new thread and uses data.is_internal', () => {
    const body = addCommentBody(readTicketServiceSource());

    const topLevelBranch = body.slice(body.indexOf('} else {'));

    // New thread row is still created for non-replies.
    expect(topLevelBranch).toContain("await trx('comment_threads').insert({");
    expect(topLevelBranch).toContain('root_comment_id: apiCommentId,');
    // Top-level visibility still derives from the request body, unchanged.
    expect(topLevelBranch).toContain('apiIsInternal = data.is_internal || false;');

    // A non-reply does not bump reply_count.
    const elseStart = body.indexOf('} else {');
    const elseEnd = body.indexOf('const commentData', elseStart);
    const elseOnly = body.slice(elseStart, elseEnd);
    expect(elseOnly).not.toContain('reply_count + 1');
  });
});
