import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskCommentActions.ts'), 'utf8');

describe('project task comment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for comment reads, mutations, and context lookups', () => {
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comments', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'comment_threads', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comment_reactions', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'project_task_comments', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')");
    expect(source).toContain("tenantDb(db, tenant).tenantJoin(commentsQuery, 'users', 'project_task_comments.user_id', 'users.user_id', { type: 'left' })");
    expect(source).not.toContain(".where('project_tasks.tenant', tenant)");
    expect(source).not.toContain(".where({ task_comment_id: taskCommentId, tenant })");
    expect(source).not.toContain(".where({ tenant, thread_id:");
    expect(source).not.toContain(".where({ task_id: taskId, tenant })");
    expect(source).not.toContain(".where({ tenant })");
  });
});
