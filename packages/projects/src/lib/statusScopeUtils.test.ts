import { describe, expect, it } from 'vitest';

import {
  createFallbackStatus,
  FALLBACK_STATUS_MAPPING_ID,
  partitionStatusScope,
} from './statusScopeUtils';
import type { IProjectTask, ProjectStatus } from '@alga-psa/types';

const phaseStatuses: ProjectStatus[] = [
  {
    project_status_mapping_id: 'in-scope-open',
    status_id: 's-open',
    name: 'Open',
    custom_name: null,
    is_visible: true,
    display_order: 1,
    is_standard: false,
    is_closed: false,
  },
  {
    project_status_mapping_id: 'in-scope-done',
    status_id: 's-done',
    name: 'Done',
    custom_name: null,
    is_visible: true,
    display_order: 2,
    is_standard: false,
    is_closed: true,
  },
];

const task = (id: string, mappingId: string): IProjectTask =>
  ({ task_id: id, project_status_mapping_id: mappingId }) as IProjectTask;

describe('statusScopeUtils render fallback', () => {
  it('creates a labelled, non-persisted fallback status', () => {
    const fallback = createFallbackStatus();
    expect(fallback.project_status_mapping_id).toBe(FALLBACK_STATUS_MAPPING_ID);
    expect(fallback.name).toBe('Needs status assignment');
    expect(fallback.is_closed).toBe(false);
  });

  it('partitionStatusScope isolates cross-scope (orphan) tasks', () => {
    const { orphanTasks } = partitionStatusScope(phaseStatuses, [
      task('t1', 'in-scope-open'),
      task('t2', 'in-scope-done'),
      task('t3', 'stale-default'),
      task('t4', null as unknown as string),
    ]);

    expect(orphanTasks.map((t) => t.task_id)).toEqual(['t3', 't4']);
  });

  it('keeps every task in scope when all are accounted for', () => {
    const { orphanTasks } = partitionStatusScope(phaseStatuses, [
      task('t1', 'in-scope-open'),
      task('t2', 'in-scope-done'),
    ]);
    expect(orphanTasks).toHaveLength(0);
  });
});