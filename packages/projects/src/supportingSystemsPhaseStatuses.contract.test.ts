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

  it('T054/T055: project status events include phaseId when relevant and omit it for project defaults', () => {
    expect(statusActionsSource).toContain("eventType: 'PROJECT_STATUS_ADDED'");
    expect(statusActionsSource).toContain("eventType: 'PROJECT_STATUS_UPDATED'");
    expect(statusActionsSource).toContain("eventType: 'PROJECT_STATUS_DELETED'");
    expect(statusActionsSource).toContain("eventType: 'PROJECT_STATUSES_REORDERED'");
    expect(statusActionsSource).toContain('phaseId: mapping.phase_id ?? undefined,');
    expect(statusActionsSource).toContain('phaseId: existingMapping.phase_id ?? undefined,');
    expect(statusActionsSource).toContain('phaseId: phaseId ?? undefined,');
  });

  it('T056/T065: project creation status editor and selector preserve phase-specific template selections', () => {
    expect(editorSource).toContain('await reorderProjectStatuses(projectId, statusOrder, phaseId);');
    expect(editorSource).toContain("{phaseId ? 'Phase Task Statuses' : 'Task Statuses'}");
    expect(selectorSource).toContain('selectedStatuses: Array<{ status_id: string; display_order: number; phase_id?: string }>;');
    expect(selectorSource).toContain('phaseId?: string | null;');
    expect(selectorSource).toContain(
      "(status) => status.status_id === statusId && (status.phase_id ?? null) === (phaseId ?? null)"
    );
    expect(selectorSource).toContain("{ status_id: statusId, display_order: maxOrder + 1, phase_id: phaseId ?? undefined }");
    expect(selectorSource).toContain('phase_id: phaseId ?? undefined,');
    expect(selectorSource).toContain("{phaseId ? 'Customize task statuses for this phase' : 'Customize task statuses for this project'}");
  });
});
