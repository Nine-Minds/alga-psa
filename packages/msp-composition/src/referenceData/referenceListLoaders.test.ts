import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  loadBoards: vi.fn(),
  loadStatuses: vi.fn(),
  loadPriorities: vi.fn(),
  loadTagsByType: vi.fn(),
  loadProjectsWithPhases: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/lib/referenceListQueries', () => ({
  loadBoards: mocks.loadBoards,
  loadStatuses: mocks.loadStatuses,
  loadPriorities: mocks.loadPriorities,
}));
vi.mock('@alga-psa/tags/lib/tagListQueries', () => ({ loadTagsByType: mocks.loadTagsByType }));
vi.mock('@alga-psa/projects/lib/projectsWithPhases', () => ({
  loadProjectsWithPhases: mocks.loadProjectsWithPhases,
}));

import { isReferenceListError } from '@alga-psa/ui/lib/referenceData';
import { loadReferenceListsFor } from './referenceListLoaders';

const db = {} as Knex;
const user = { user_id: 'u1', tenant: 't1' } as IUserWithRoles;

describe('loadReferenceListsFor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadBoards.mockResolvedValue([{ board_id: 'b1' }]);
    mocks.loadStatuses.mockResolvedValue([{ status_id: 's1' }]);
    mocks.loadPriorities.mockImplementation(async (_d, _t, type) => [{ priority_id: `p-${type}` }]);
    mocks.loadTagsByType.mockImplementation(async (_d, _t, _u, type) => [{ tag_id: `tag-${type}` }]);
    mocks.loadProjectsWithPhases.mockResolvedValue([{ project_id: 'pr1', phases: [] }]);
  });

  it('calls each list body with the same arguments the existing actions use', async () => {
    const result = await loadReferenceListsFor(db, 't1', user, [
      'boards',
      'ticketStatuses',
      'ticketTags',
      'projectTaskTags',
      'projectsWithPhases',
      'priorities:ticket',
      'priorities:project_task',
    ]);
    expect(mocks.loadBoards).toHaveBeenCalledWith(db, 't1', true);
    expect(mocks.loadStatuses).toHaveBeenCalledWith(db, 't1', 'ticket');
    expect(mocks.loadTagsByType).toHaveBeenCalledWith(db, 't1', user, 'ticket');
    expect(mocks.loadTagsByType).toHaveBeenCalledWith(db, 't1', user, 'project_task');
    expect(mocks.loadProjectsWithPhases).toHaveBeenCalledWith(db, 't1', user);
    expect(mocks.loadPriorities).toHaveBeenCalledWith(db, 't1', 'ticket');
    expect(mocks.loadPriorities).toHaveBeenCalledWith(db, 't1', 'project_task');
    expect(result.boards).toEqual([{ board_id: 'b1' }]);
    expect(result['priorities:project_task']).toEqual([{ priority_id: 'p-project_task' }]);
    expect(result.ticketTags).toEqual([{ tag_id: 'tag-ticket' }]);
  });

  it('only runs the requested keys, once each', async () => {
    const result = await loadReferenceListsFor(db, 't1', user, ['boards', 'boards']);
    expect(Object.keys(result)).toEqual(['boards']);
    expect(mocks.loadBoards).toHaveBeenCalledTimes(1);
    expect(mocks.loadProjectsWithPhases).not.toHaveBeenCalled();
  });

  it('runs the loaders in parallel', async () => {
    const release: Array<() => void> = [];
    mocks.loadBoards.mockImplementation(() => new Promise((resolve) => release.push(() => resolve([]))));
    mocks.loadStatuses.mockImplementation(() => new Promise((resolve) => release.push(() => resolve([]))));
    const pending = loadReferenceListsFor(db, 't1', user, ['boards', 'ticketStatuses']);
    await Promise.resolve();
    expect(mocks.loadBoards).toHaveBeenCalled();
    expect(mocks.loadStatuses).toHaveBeenCalled(); // started before the first one settled
    release.forEach((fn) => fn());
    await pending;
  });

  it('returns a permission denial for projects as an error marker for that key only', async () => {
    mocks.loadProjectsWithPhases.mockResolvedValue({ permissionError: 'Permission denied: Cannot read project' });
    const result = await loadReferenceListsFor(db, 't1', user, ['boards', 'projectsWithPhases', 'ticketTags']);
    expect(isReferenceListError(result.projectsWithPhases)).toBe(true);
    expect(result.boards).toEqual([{ board_id: 'b1' }]);
    expect(result.ticketTags).toEqual([{ tag_id: 'tag-ticket' }]);
  });

  it('isolates a throwing loader', async () => {
    mocks.loadTagsByType.mockRejectedValue(new Error('tag read failed'));
    const result = await loadReferenceListsFor(db, 't1', user, ['boards', 'ticketTags', 'projectTaskTags']);
    expect(isReferenceListError(result.ticketTags)).toBe(true);
    expect(isReferenceListError(result.projectTaskTags)).toBe(true);
    expect(result.boards).toEqual([{ board_id: 'b1' }]);
  });

  it('marks an unknown key without failing the batch', async () => {
    const result = await loadReferenceListsFor(db, 't1', user, ['boards', 'nope' as never]);
    expect(isReferenceListError(result['nope' as never])).toBe(true);
    expect(result.boards).toBeDefined();
  });
});
