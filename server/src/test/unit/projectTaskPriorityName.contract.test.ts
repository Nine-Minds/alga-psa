import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectTaskResponseSchema } from '../../lib/api/schemas/project';

/**
 * The task response schema has always typed `priority_name`, but getTaskById
 * joined phases, projects, statuses, users and the service catalog and never
 * the priorities table. Mobile's new Priority row therefore read "none" for
 * every task, and a saved edit flipped back to it on reload. This pins the
 * tenant-scoped join that fills the field.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('project task detail priority name', () => {
  it('joins the tenant priority row and selects its name', () => {
    const text = source('server/src/lib/api/services/ProjectService.ts');
    const start = text.indexOf('async getTaskById(');
    expect(start).toBeGreaterThan(0);
    const section = text.slice(start, text.indexOf('return task || null;', start));

    expect(section).toContain("db.tenantJoin(query, 'priorities as pri', 'project_tasks.priority_id', 'pri.priority_id', { type: 'left' })");
    expect(section).toContain("'pri.priority_name'");
    expect(section).not.toContain('.leftJoin(');
  });

  it('types the joined name on the task response schema', () => {
    const parsed = projectTaskResponseSchema.partial().parse({ priority_name: 'High' });

    expect(parsed.priority_name).toBe('High');
  });

  it('leaves the public task schema untouched, like the two sibling join names', () => {
    const text = source('server/src/lib/api/openapi/routes/projects.ts');
    const omitted = text.slice(text.indexOf('projectTaskResponseSchema.omit({'));

    expect(omitted.slice(0, 200)).toContain('assigned_user_name: true');
    expect(omitted.slice(0, 200)).toContain('priority_name: true');
    expect(omitted.slice(0, 200)).toContain('status_name: true');
  });
});
