import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('phase-scope status-mapping write+render contracts', () => {
  const statusActionsSource = read('../actions/projectTaskStatusActions.ts');
  const templateSource = read('../services/applyProjectTemplate.ts');
  const kanbanSource = read('../components/KanbanBoard.tsx');
  const listSource = read('../components/TaskListView.tsx');
  const utilsSource = read('../lib/statusScopeUtils.ts');
  const projectDetailSource = read('../components/ProjectDetail.tsx');

  it('T001: addStatusToProject establishes the full phase scope before inserting the new mapping', () => {
    expect(statusActionsSource).toContain('export const addStatusToProject = withAuth(async (');
    expect(statusActionsSource).toContain('if (phaseId) {');
    expect(statusActionsSource).toContain(
      'await ProjectModel.copyProjectStatusMappingsToPhase(trx, tenant, projectId, phaseId);'
    );
  });

  it('T002: applyProjectTemplate resolves every task mapping into the created phase scope', () => {
    expect(templateSource).toContain(
      'const resolvedMapping = await ProjectModel.resolveTaskStatusMapping('
    );
    expect(templateSource).toContain('{ allowRemap: true }');
  });

  it('T003: Kanban surfaces legacy orphans in a labelled fallback column', () => {
    expect(kanbanSource).toContain("from '../lib/statusScopeUtils';");
    expect(kanbanSource).toContain('partitionStatusScope(scopeStatuses, enrichedPhaseTasks)');
    expect(kanbanSource).toContain('createFallbackStatus()');
    expect(kanbanSource).toContain('orphanTasks.length > 0 && (');
  });

  it('T004: List surfaces legacy orphans in a labelled fallback group', () => {
    expect(listSource).toContain("from '../lib/statusScopeUtils';");
    expect(listSource).toContain('partitionStatusScope(phaseStatuses, phaseTasks)');
    expect(listSource).toContain('statusGroups.push({ status: createFallbackStatus(), tasks: orphanTasks })');
    // The fallback group is never a drop target.
    expect(listSource).toContain('if (statusId === FALLBACK_STATUS_MAPPING_ID)');
  });

  it('T005: Kanban computes orphans against the phase effective scope, not the display-filtered subset', () => {
    expect(projectDetailSource).toContain('effectiveStatuses={projectStatuses}');
    expect(kanbanSource).toContain('effectiveStatuses?: ProjectStatus[];');
    expect(kanbanSource).toContain('const scopeStatuses = effectiveStatuses || statuses;');
  });

  it('T006: shared util provides a synthetic non-persisted fallback status', () => {
    expect(utilsSource).toContain("export const FALLBACK_STATUS_MAPPING_ID = '__needs_status_assignment__';");
    expect(utilsSource).toContain('export function createFallbackStatus()');
    expect(utilsSource).toContain('orphanTasks');
  });
});