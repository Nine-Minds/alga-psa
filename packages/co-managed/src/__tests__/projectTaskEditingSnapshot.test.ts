import { describe, expect, it } from 'vitest';
import { projectCoManagedTaskSnapshot } from '../projectTaskEditing';

describe('projectCoManagedTaskSnapshot', () => {
  const reference: any = { revision: 8, hasAssignment: true, assigneeKind: 'user', assigneeName: 'QA Tester' };
  const task: any = { updated_at: '2026-11-03T12:00:00Z', task_name: 'Replace core switch', due_date: null, project_status_mapping_id: null };
  it('keeps an unredacted snapshot visible', () => {
    expect(projectCoManagedTaskSnapshot(reference, task, [])).toMatchObject({ revision: 8, assignee: { name: 'QA Tester' } });
  });
  it.each(['assignee_name', 'users', 'teams'])('masks the fresh conflict snapshot under %s', redaction => {
    const snapshot = projectCoManagedTaskSnapshot({ ...reference, assigneeName: null, assignedToMe: null }, task, [redaction]);
    expect(snapshot.assignee).not.toBeNull();
    expect(snapshot).toMatchObject({ revision: 8, values: { task_name: 'Replace core switch' }, assignee: { kind: 'user', name: null } });
    expect(JSON.stringify(snapshot)).not.toContain('QA Tester');
  });
  it('keeps a genuinely unassigned task unassigned', () => {
    expect(projectCoManagedTaskSnapshot({ ...reference, hasAssignment: false, assigneeKind: null, assigneeName: null }, task, ['assignee_name']).assignee).toBeNull();
  });
});
