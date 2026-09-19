import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskCommentReactionActions.ts'), 'utf8');

// Same handle rename as projectTaskCommentTenantScoped: reads moved onto the caller's `trx`.
describe('project task comment reaction tenant-scoped query contract', () => {
  it('uses structural tenant scoping for reaction and user roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comment_reactions', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).not.toContain('.where({ tenant, task_comment_id: taskCommentId, user_id: userId, emoji })');
    expect(source).not.toContain('.where({ tenant, reaction_id: existing.reaction_id })');
    expect(source).not.toContain('.where({ tenant })');
    expect(source).not.toContain('tenantScopedTable(db,');
  });
});
