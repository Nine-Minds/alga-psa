import { describe, it, expect } from 'vitest';
import type { IProjectTask } from '@alga-psa/types';
import { computeTaskEditChanges, refusedFieldLabels, taskEditSignature, type TaskEditFormValues } from './taskEditChanges';

const task = {
  task_id: 't1', task_name: 'A', phase_id: 'p1', project_status_mapping_id: 's1', assigned_to: 'u1',
  assigned_team_id: null, estimated_hours: 120, start_date: null, due_date: '2026-01-02T00:00:00.000Z',
  priority_id: null, task_type_key: 'task', service_id: null,
} as unknown as IProjectTask;

const same: TaskEditFormValues = {
  taskName: 'A', descriptionSerialized: 'd', loadedDescriptionSerialized: 'd', statusId: 's1', phaseId: 'p1',
  assignedTo: 'u1', assignedTeamId: null, estimatedHours: 2, startDate: undefined,
  dueDate: new Date('2026-01-02T00:00:00.000Z'), priorityId: null, taskTypeKey: 'task', serviceId: null,
  checklistItems: [], checklistModified: false,
};

describe('computeTaskEditChanges', () => {
  it('is empty when nothing changed', () => {
    expect(computeTaskEditChanges(task, same)).toEqual({});
  });
  it('includes only differing fields, with minutes and ISO dates', () => {
    const c = computeTaskEditChanges(task, {
      ...same, taskName: 'B', estimatedHours: 1.5, dueDate: null, startDate: new Date('2026-02-01T00:00:00.000Z'),
      statusId: 's2', descriptionSerialized: 'e', assignedTo: '',
    });
    expect(c).toEqual({
      task_name: 'B', estimated_hours: 90, due_date: null, start_date: '2026-02-01T00:00:00.000Z',
      project_status_mapping_id: 's2', description: 'e', assigned_to: null,
    });
  });
  it('includes checklist only when modified and optional collections only when provided', () => {
    expect(computeTaskEditChanges(task, { ...same, checklistItems: [1], checklistModified: true }).checklist_items).toEqual([1]);
    const c = computeTaskEditChanges(task, { ...same, tags: ['x'] });
    expect(c).toEqual({ tags: ['x'] });
  });
});

describe('taskEditSignature', () => {
  it('ignores key order', () => {
    expect(taskEditSignature('t', { a: 1, b: 2 })).toBe(taskEditSignature('t', { b: 2, a: 1 }));
    expect(taskEditSignature('t', { a: 1 })).not.toBe(taskEditSignature('t', { a: 2 }));
  });
});

describe('refusedFieldLabels', () => {
  it('maps known columns through translate and falls back to the column name', () => {
    const out = refusedFieldLabels(['due_date', 'weird'], (_k, fb) => fb);
    expect(out).toEqual(['Due date', 'weird']);
  });
});
