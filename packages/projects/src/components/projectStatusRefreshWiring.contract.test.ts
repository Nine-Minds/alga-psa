import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Deleting a status column inside the project edit drawer moves its tasks right
 * away, but the board rendered next to the drawer keeps its own copy of the
 * tasks: it showed the destination column empty and the list view still filed
 * the tasks under the column that had just been removed, until a page reload.
 * ProjectDetail is too large to mount in a unit test, so these contracts pin
 * the refresh chain: the drawer's close tells the page, the page bumps a key,
 * and the key feeds the same re-read that an in-board status edit triggers.
 */
const detailSource = readFileSync(path.resolve(__dirname, 'ProjectDetail.tsx'), 'utf8');
const infoSource = readFileSync(path.resolve(__dirname, 'ProjectInfo.tsx'), 'utf8');
const pageSource = readFileSync(path.resolve(__dirname, 'ProjectPage.tsx'), 'utf8');
const listSource = readFileSync(path.resolve(__dirname, 'TaskListView.tsx'), 'utf8');

describe('status column edits in the edit drawer refresh the board', () => {
  it('the drawer reports every close, however it was dismissed', () => {
    expect(infoSource).toContain('onStatusesChanged?: () => void;');
    const open = infoSource.indexOf('<ProjectDetailsEdit');
    expect(open).toBeGreaterThan(-1);
    const openCall = infoSource.slice(open, infoSource.indexOf('};', open));
    // Escape and the header X never reach Save or Cancel; they dismiss through
    // the outlet's own `closeDrawer`, which fires the `onClose` argument of
    // `openDrawer`.
    expect(openCall).toMatch(/\/>,\s*(?:\/\/[^\n]*\n\s*)*undefined,(?:\s*\/\/[^\n]*\n)*\s*\(\) => onStatusesChanged\?\.\(\),/);
    // `onClose` alone is not enough: DrawerContext memoizes `closeDrawer` on
    // the current history entry, so the one these two handlers captured — from
    // the render before this drawer opened, when there was no entry — skips
    // `onClose` entirely. Each must report for itself.
    const save = openCall.indexOf('onSave={');
    const cancel = openCall.indexOf('onCancel={');
    expect(save).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(save);
    expect(openCall.slice(save, cancel)).toContain('onStatusesChanged?.();');
    expect(openCall.slice(cancel)).toContain('onStatusesChanged?.();');
  });

  it('the page turns that report into a refresh key for the board', () => {
    expect(pageSource).toContain('const [statusRefreshKey, setStatusRefreshKey] = useState(0);');
    expect(pageSource).toMatch(
      /const handleStatusesChanged = useCallback\(\(\) => \{\s*setStatusRefreshKey\(key => key \+ 1\);\s*\}, \[\]\);/
    );
    expect(pageSource).toContain('onStatusesChanged={handleStatusesChanged}');
    expect(pageSource).toContain('statusRefreshKey={statusRefreshKey}');
  });

  it('the board folds the key into the version its status and task re-reads watch', () => {
    expect(detailSource).toContain('statusRefreshKey?: number;');
    expect(detailSource).toContain('const statusVersion = localStatusVersion + (statusRefreshKey ?? 0);');
    // The task fetch is the one that went stale: it must watch the version.
    const fetchTasks = detailSource.indexOf('const fetchPhaseTasks = async () => {');
    expect(fetchTasks).toBeGreaterThan(-1);
    expect(detailSource.slice(fetchTasks)).toMatch(/\}, \[selectedPhase\?\.phase_id, statusVersion\]\);/);
    // An in-board status edit still bumps its own counter, so the two sources
    // cannot cancel each other out.
    expect(detailSource).toContain('setLocalStatusVersion(v => v + 1)');
    expect(detailSource).not.toContain('setStatusVersion(');
  });

  it('the project-wide task data re-reads on the same version', () => {
    // The list view does not use the board's per-phase state: it buckets
    // `allProjectTasks` with `statusesByPhase`, and its row status picker only
    // offers the columns those groups carry. Both come from this one fetch, so
    // it has to watch the version as well or the list keeps a deleted column
    // (with its tasks still in it) and misses a newly added one.
    const fetchAll = detailSource.indexOf('const fetchAllTaskData = async () => {');
    expect(fetchAll).toBeGreaterThan(-1);
    const fetchAllBlock = detailSource.slice(fetchAll);
    expect(fetchAllBlock).toContain('projectSource.options.statusesByPhase(project.project_id)');
    expect(fetchAllBlock).toMatch(/\}, \[project\.project_id, statusVersion\]\);/);
    // Pin the coupling the assertion above relies on.
    expect(listSource).toContain('const phaseStatuses = statusesByPhase[phase.phase_id] ?? statuses;');
    expect(listSource).toContain('const phaseStatusOptions = phaseGroup.statusGroups.map(sg => sg.status);');
  });
});
