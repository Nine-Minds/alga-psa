import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');

describe('supporting per-phase status system contracts', () => {
  const importSource = readWorkspaceFile('packages/projects/src/actions/phaseTaskImportActions.ts');
  const statusActionsSource = readWorkspaceFile('packages/projects/src/actions/projectTaskStatusActions.ts');
  const editorSource = readWorkspaceFile('packages/projects/src/components/ProjectTaskStatusEditor.tsx');
  const selectorSource = readWorkspaceFile('packages/projects/src/components/ProjectTaskStatusSelector.tsx');

  it('T053: phase task import builds per-phase effective status lookups from phase-specific or default mappings', () => {
    expect(importSource).toContain('const defaultMappings = statusMappings.filter((mapping) => !mapping.phase_id);');
    expect(importSource).toContain(
      'const phaseMappings = statusMappings.filter((mapping) => mapping.phase_id === phase.phase_id);'
    );
    expect(importSource).toContain('const effectiveMappings = phaseMappings.length > 0 ? phaseMappings : defaultMappings;');
    expect(importSource).toContain('statusLookupByPhase[phase.phase_name.toLowerCase().trim()] = buildStatusLookupFromMappings(');
  });

  it('T054/T055: status mutations no longer publish project status events', () => {
    // PROJECT_STATUS_ADDED/UPDATED/DELETED/REORDERED event publication was
    // removed from projectTaskStatusActions.ts in the per-phase status rework
    // (commit d17fd65dae 'Add per-phase custom statuses and fix kanban UX').
    // The actions module must not retain stale event-bus publication.
    expect(statusActionsSource).not.toContain('publishEvent');
    expect(statusActionsSource).not.toContain("eventType: 'PROJECT_STATUS_ADDED'");
    expect(statusActionsSource).not.toContain("eventType: 'PROJECT_STATUS_UPDATED'");
    expect(statusActionsSource).not.toContain("eventType: 'PROJECT_STATUS_DELETED'");
    expect(statusActionsSource).not.toContain("eventType: 'PROJECT_STATUSES_REORDERED'");
  });

  it('T056/T065: project creation status editor and selector preserve phase-specific template selections', () => {
    expect(editorSource).toContain('await reorderProjectStatuses(projectId, statusOrder, phaseId);');
    expect(editorSource).toContain("t('settings.statuses.phase_task_statuses_label', 'Phase Task Statuses')");
    expect(editorSource).toContain("t('settings.statuses.task_statuses_label', 'Task Statuses')");
    expect(selectorSource).toContain('selectedStatuses: Array<{ status_id: string; display_order: number; phase_id?: string }>;');
    expect(selectorSource).toContain('phaseId?: string | null;');
    expect(selectorSource).toContain(
      "(status) => status.status_id === statusId && (status.phase_id ?? null) === (phaseId ?? null)"
    );
    expect(selectorSource).toContain("{ status_id: statusId, display_order: maxOrder + 1, phase_id: phaseId ?? undefined }");
    expect(selectorSource).toContain('phase_id: phaseId ?? undefined,');
    expect(selectorSource).toContain("t('settings.statuses.customize_phase', 'Customize task statuses for this phase')");
    expect(selectorSource).toContain("t('settings.statuses.customize_project', 'Customize task statuses for this project')");
  });
});
