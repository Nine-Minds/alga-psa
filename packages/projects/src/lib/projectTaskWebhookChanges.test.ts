import { describe, expect, it } from 'vitest';

import type { IProjectTask } from '@alga-psa/types';
import { buildProjectTaskWebhookChanges } from './projectTaskWebhookChanges';

function task(overrides: Partial<IProjectTask> = {}): IProjectTask {
  return {
    tenant: 'tenant-1',
    task_id: 'task-1',
    phase_id: 'phase-1',
    task_name: 'Original task',
    description: 'Original description',
    assigned_to: null,
    estimated_hours: 2,
    actual_hours: 1,
    project_status_mapping_id: 'status-1',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    wbs_code: '1.1',
    due_date: new Date('2026-01-10T00:00:00.000Z'),
    priority_id: null,
    service_id: null,
    task_type_key: 'task',
    order_key: undefined,
    ...overrides,
  };
}

describe('buildProjectTaskWebhookChanges', () => {
  it('returns a normalized diff for tracked changed fields only', () => {
    const before = task();
    const after = task({
      task_name: 'Updated task',
      estimated_hours: 3,
      due_date: new Date('2026-01-11T00:00:00.000Z'),
    });

    expect(
      buildProjectTaskWebhookChanges(before, after, [
        'task_name',
        'estimated_hours',
        'due_date',
        'description',
      ]),
    ).toEqual({
      task_name: {
        previous: 'Original task',
        new: 'Updated task',
      },
      estimated_hours: {
        previous: 2,
        new: 3,
      },
      due_date: {
        previous: '2026-01-10T00:00:00.000Z',
        new: '2026-01-11T00:00:00.000Z',
      },
    });
  });

  it('returns an empty diff when tracked values do not change', () => {
    expect(
      buildProjectTaskWebhookChanges(task(), task(), [
        'task_name',
        'estimated_hours',
        'due_date',
      ]),
    ).toEqual({});
  });
});
