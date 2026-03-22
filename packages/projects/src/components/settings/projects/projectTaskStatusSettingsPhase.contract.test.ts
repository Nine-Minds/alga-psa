import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(
  path.resolve(__dirname, 'ProjectTaskStatusSettings.tsx'),
  'utf8'
);
const addDialogSource = readFileSync(
  path.resolve(__dirname, 'AddStatusDialog.tsx'),
  'utf8'
);
const actionsSource = readFileSync(
  path.resolve(__dirname, '../../../actions/projectTaskStatusActions.ts'),
  'utf8'
);

describe('phase-aware project status settings contracts', () => {
  it('T039/T040: phase selector includes project defaults and toggles phase default-vs-custom state', () => {
    expect(settingsSource).toContain("const DEFAULT_SCOPE = '__project_defaults__';");
    expect(settingsSource).toContain("{ value: DEFAULT_SCOPE, label: 'Project Defaults' },");
    expect(settingsSource).toContain("label className=\"mb-2 block text-sm font-medium\">Status Scope</label>");
    expect(settingsSource).toContain('const isUsingProjectDefaults = Boolean(selectedPhaseId) && !hasCustomStatuses;');
    expect(settingsSource).toContain('Use project defaults');
    expect(settingsSource).toContain('Custom statuses');
  });

  it('T041/T042/T043: settings expose copy-from-defaults and revert-to-default flows for phases', () => {
    expect(settingsSource).toContain('async function handleCopyDefaultsToPhase() {');
    expect(settingsSource).toContain('await copyProjectStatusesToPhase(projectId, selectedPhaseId);');
    expect(settingsSource).toContain('Copy from project defaults');
    expect(settingsSource).toContain('async function handleRevertToDefaults() {');
    expect(settingsSource).toContain("if (!confirm('Remove this phase\\'s custom statuses and revert to project defaults?')) {");
    expect(settingsSource).toContain('await removePhaseStatuses(selectedPhaseId);');
  });

  it('T044/T045: AddStatusDialog accepts phaseId and forwards it when adding phase statuses', () => {
    expect(settingsSource).toContain('<AddStatusDialog');
    expect(settingsSource).toContain('phaseId={selectedPhaseId}');
    expect(addDialogSource).toContain('phaseId?: string | null;');
    expect(addDialogSource).toContain('export function AddStatusDialog({ projectId, phaseId, onClose, onAdded }: AddStatusDialogProps)');
    expect(addDialogSource).toContain("await addStatusToProject(projectId, {");
    expect(addDialogSource).toContain('}, phaseId);');
    expect(addDialogSource).toContain("title={phaseId ? 'Add Phase Status from Library' : 'Add Status from Library'}");
  });

  it('T062: status deletion still blocks removing the last remaining status mapping', () => {
    expect(actionsSource).toContain("const remainingCount = await trx('project_status_mappings')");
    expect(actionsSource).toContain("count('* as count')");
    expect(actionsSource).toContain("if (parseInt(remainingCount?.count as string) <= 1) {");
    expect(actionsSource).toContain("throw new Error('Cannot delete the last status in a project');");
  });
});
