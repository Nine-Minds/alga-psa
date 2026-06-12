import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('per-user hidden kanban columns contracts', () => {
  const projectDetailSource = read('ProjectDetail.tsx');
  const kanbanBoardSource = read('KanbanBoard.tsx');
  const statusColumnSource = read('StatusColumn.tsx');
  const projectActionsSource = read('../actions/projectActions.ts');
  const enLocale = JSON.parse(read('../../../../server/public/locales/en/features/projects.json'));

  it('stores hidden columns as a per-project user preference of status identities', () => {
    expect(projectDetailSource).toContain(
      'const hiddenStatusesPrefKey = projectKanbanHiddenStatusesKey(project.project_id);'
    );
    expect(projectDetailSource).toContain(
      '{ key: hiddenStatusesPrefKey, defaultValue: [] as string[], debounceMs: 300 },'
    );
    expect(projectDetailSource).toContain('new Set(normalizeHiddenStatusIds(hiddenKanbanStatusIds))');
    expect(projectDetailSource).toContain(
      'setHiddenKanbanStatusIds((prev: string[]) => toggleHiddenStatusId(prev, statusIdentity));'
    );
    expect(projectDetailSource).toContain('setHiddenKanbanStatusIds([]);');
  });

  it('force-reveals hidden columns for search matches and the selected task', () => {
    expect(projectDetailSource).toContain('const forceVisibleStatusMappingIds = useMemo(');
    expect(projectDetailSource).toContain('if (searchQuery.trim()) {');
    expect(projectDetailSource).toContain('addIfHidden(task.project_status_mapping_id);');
    expect(projectDetailSource).toContain('addIfHidden(selectedTask.project_status_mapping_id);');
    expect(projectDetailSource).toContain(
      'forceVisibleStatusMappingIds.has(status.project_status_mapping_id)'
    );
    expect(projectDetailSource).toContain('revealedHiddenStatusIds={forceVisibleStatusMappingIds}');
  });

  it('marks force-revealed columns and flips their hide control to a show control', () => {
    expect(kanbanBoardSource).toContain('revealedHiddenStatusIds?: Set<string>;');
    expect(kanbanBoardSource).toContain(
      'isRevealedHidden={revealedHiddenStatusIds?.has(status.project_status_mapping_id) ?? false}'
    );
    expect(statusColumnSource).toContain('isRevealedHidden = false,');
    expect(statusColumnSource).toContain('isRevealedHidden ? styles.revealedHiddenColumn : ');
    expect(statusColumnSource).toContain('isRevealedHidden ? styles.revealedHiddenHeader : ');
    expect(statusColumnSource).toContain("? t('projectDetail.showColumn', 'Show column')");
    expect(statusColumnSource).toContain(": t('projectDetail.hideColumn', 'Hide column')");
    expect(statusColumnSource).toContain('? <Eye className=');
    expect(statusColumnSource).toContain(': <EyeOff className=');
  });

  it('offers column visibility controls and a recovery state when all columns are hidden', () => {
    expect(projectDetailSource).toContain('id="kanban-column-visibility-toggle"');
    expect(projectDetailSource).toContain('id="kanban-show-all-columns"');
    expect(projectDetailSource).toContain(
      'displayedKanbanStatuses.length === 0 && hiddenVisibleStatusCount > 0 ?'
    );
    expect(projectDetailSource).toContain('id="kanban-all-columns-hidden"');
    expect(projectDetailSource).toContain('id="kanban-show-all-columns-empty"');
    expect(projectDetailSource).toContain('onHideColumn={toggleKanbanStatusHidden}');
  });

  it('deleteProject removes the per-user hidden-column preferences', () => {
    expect(projectActionsSource).toContain(
      "import { projectKanbanHiddenStatusesKey } from '../lib/kanbanPreferences';"
    );
    expect(projectActionsSource).toContain(
      '.where({ tenant: tenantId, setting_name: projectKanbanHiddenStatusesKey(projectId) })'
    );
  });

  it('en locale defines every key the feature uses', () => {
    const keys = [
      'showHideColumns',
      'columns',
      'showAll',
      'noColumns',
      'allColumnsHidden',
      'allColumnsHiddenHint',
      'showAllColumns',
      'hideColumn',
      'showColumn',
      'addTask',
    ];
    for (const key of keys) {
      expect(typeof enLocale.projectDetail?.[key], `projectDetail.${key}`).toBe('string');
    }
  });
});
