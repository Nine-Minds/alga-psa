import { describe, expect, it } from 'vitest';
import { matchRecordPath } from '@alga-psa/types';
import { urlFor } from './time_entry';

const base = { entry_id: 'e1', work_item_id: null, project_id: null } as never;
const row = (extra: Record<string, unknown>) => ({ ...(base as object), ...extra }) as never;

describe('time entry search URLs use the canonical record resolver', () => {
  it('ticket work item', () => {
    const url = urlFor(row({ work_item_type: 'ticket', work_item_id: 't-1' }));
    expect(url).toBe('/msp/tickets/t-1');
    expect(matchRecordPath(url)).toEqual({ entityType: 'ticket', id: 't-1' });
  });

  it('project task work item uses ?taskId= (not the legacy /tasks/ redirect)', () => {
    const url = urlFor(row({ work_item_type: 'project_task', work_item_id: 'task-1', project_id: 'p-1' }));
    expect(url).toBe('/msp/projects/p-1?taskId=task-1');
    expect(matchRecordPath(url)).toEqual({ entityType: 'project_task', id: 'task-1', projectId: 'p-1' });
  });

  it('non-record work items keep their existing URLs', () => {
    expect(urlFor(row({ work_item_type: 'interaction', work_item_id: 'i-1' }))).toBe('/msp/interactions/i-1');
    expect(urlFor(row({ work_item_type: 'ad_hoc' }))).toBe('/msp/time-entries/e1');
  });
});
