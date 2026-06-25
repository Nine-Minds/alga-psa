import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TicketService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('ticket service comments and search tenant-scoped query contract', () => {
  it('uses structural tenant scoping for comment/reaction/search roots', () => {
    const commentsSection = sectionBetween('async getTicketComments', '  /**\n   * Add comment');
    const addCommentSection = sectionBetween('async addComment', '  /**\n   * Update an existing comment');
    const updateCommentSection = sectionBetween('async updateComment', '  /**\n   * Search tickets');
    const searchSection = sectionBetween('async search', '  /**\n   * Get ticket statistics');

    expect(commentsSection).toContain("tenantScopedTable(knex, 'comments as tc', context.tenant)");
    expect(commentsSection).toContain("tenantScopedTable(knex, 'comment_reactions', context.tenant)");
    expect(commentsSection).toContain("tenantScopedTable(knex, 'users', context.tenant)");
    expect(commentsSection).not.toContain("'tc.tenant': context.tenant");
    expect(commentsSection).not.toContain('.where({ tenant: context.tenant })');

    expect(addCommentSection).toContain("tenantScopedTable(trx, 'tickets', context.tenant)");
    expect(addCommentSection).toContain("tenantScopedTable(trx, 'comments as parent', context.tenant)");
    expect(addCommentSection).toContain("tenantScopedTable(trx, 'comment_threads', context.tenant)");
    expect(addCommentSection).toContain("tenantScopedTable(trx, 'users', context.tenant)");
    expect(addCommentSection).not.toContain('.where({ ticket_id: ticketId, tenant: context.tenant })');
    expect(addCommentSection).not.toContain(".where('parent.tenant', context.tenant)");
    expect(addCommentSection).not.toContain('.where({ tenant: context.tenant, thread_id: apiThreadId })');
    expect(addCommentSection).not.toContain('.where({ user_id: context.userId, tenant: context.tenant })');

    expect(updateCommentSection).toContain("tenantScopedTable(trx, 'comments', context.tenant)");
    expect(updateCommentSection).not.toContain('.where({ comment_id: commentId, ticket_id: ticketId, tenant: context.tenant })');
    expect(updateCommentSection).not.toContain('.where({ comment_id: commentId, tenant: context.tenant })');

    expect(searchSection).toContain("tenantScopedTable(knex, 'tickets as t', context.tenant)");
    expect(searchSection).not.toContain(".where('t.tenant', context.tenant)");
  });
});
