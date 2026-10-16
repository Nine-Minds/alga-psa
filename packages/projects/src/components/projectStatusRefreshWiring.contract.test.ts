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

describe('status column edits in the edit drawer refresh the board', () => {
  it('the drawer reports a close on both save and cancel', () => {
    expect(infoSource).toContain('onStatusesChanged?: () => void;');
    // Save and Cancel both close the drawer, and a deletion is already written
    // by then, so both have to report it.
    const save = infoSource.indexOf('onSave={(updatedProject) => {');
    const cancel = infoSource.indexOf('onCancel={() => {');
    expect(save).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(save);
    expect(infoSource.slice(save, cancel)).toContain('onStatusesChanged?.();');
    expect(infoSource.slice(cancel)).toContain('onStatusesChanged?.();');
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
});
