import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskCommentActions.ts'), 'utf8');

// The scoped handle is named `trx` throughout: every query in this module now runs on the
// caller's transaction (see scripts/check-transaction-threading.mjs), where it used to open
// a separate `db` connection for reads. That is a handle rename, not a loss of scoping — the
// structural assertions below still pin every root, and `db` is asserted gone entirely so the
// unthreaded handle cannot quietly come back.
describe('project task comment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for comment reads, mutations, and context lookups', () => {
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comments', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'comment_threads', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comment_reactions', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comments', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')");
    expect(source).toContain("tenantDb(trx, tenant).tenantJoin(commentsQuery, 'users', 'project_task_comments.user_id', 'users.user_id', { type: 'left' })");
    expect(source).not.toContain(".where('project_tasks.tenant', tenant)");
    expect(source).not.toContain(".where({ task_comment_id: taskCommentId, tenant })");
    expect(source).not.toContain(".where({ tenant, thread_id:");
    expect(source).not.toContain(".where({ task_id: taskId, tenant })");
    expect(source).not.toContain(".where({ tenant })");
    expect(source).not.toContain("tenantScopedTable(db,");
    expect(source).not.toContain("tenantDb(db,");
  });
});
