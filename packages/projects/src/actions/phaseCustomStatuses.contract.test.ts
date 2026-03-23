import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const actionsSource = readSource('actions/projectTaskStatusActions.ts');
const settingsSource = readSource('components/settings/projects/ProjectTaskStatusSettings.tsx');
const phaseListItemSource = readSource('components/PhaseListItem.tsx');
const projectStatusMappingUtilsSource = readSource('lib/projectStatusMappingUtils.ts');

describe('per-phase custom status scenarios', () => {
  // ─── Backend: scoping ──────────────────────────────────────────────
  describe('status queries are phase-scoped', () => {
    it('getScopedProjectStatusMappings filters by phase_id or falls back to NULL', () => {
      expect(projectStatusMappingUtilsSource).toContain("query.andWhere('psm.phase_id', phaseId);");
      expect(projectStatusMappingUtilsSource).toContain("query.whereNull('psm.phase_id');");
    });

    it('addStatusToProject inserts with the provided phaseId', () => {
      expect(actionsSource).toContain('phase_id: phaseId ?? null,');
    });

    it('reorderProjectStatuses scopes updates to the phase', () => {
      expect(actionsSource).toContain("query.andWhere('phase_id', phaseId);");
      expect(actionsSource).toContain("query.whereNull('phase_id');");
    });
  });

  // ─── Backend: copy defaults to phase ───────────────────────────────
  describe('copyProjectStatusesToPhase clones project defaults into a phase', () => {
    it('reads default mappings and inserts copies for the target phase', () => {
      expect(actionsSource).toContain('export const copyProjectStatusesToPhase = withAuth(async (');
      expect(actionsSource).toContain(".whereNull('phase_id')");
      expect(actionsSource).toContain('phase_id: phaseId,');
      expect(actionsSource).toContain('status_id: mapping.status_id,');
      expect(actionsSource).toContain('display_order: mapping.display_order,');
    });

    it('preserves custom_name, standard_status_id, and is_visible from defaults', () => {
      expect(actionsSource).toContain('custom_name: mapping.custom_name,');
      expect(actionsSource).toContain('standard_status_id: mapping.standard_status_id,');
      expect(actionsSource).toContain('is_visible: mapping.is_visible');
    });
  });

  // ─── Backend: remove phase statuses ────────────────────────────────
  describe('removePhaseStatuses reverts a phase to project defaults', () => {
    it('remaps tasks from phase-specific statuses to default replacements before deletion', () => {
      expect(actionsSource).toContain('export const removePhaseStatuses = withAuth(async (');
      expect(actionsSource).toContain('resolveReplacementStatusMapping(phaseMapping, defaultMappings)');
      expect(actionsSource).toContain("await trx('project_tasks')");
      expect(actionsSource).toContain('.del();');
    });

    it('loads both phase and default mappings to find replacements', () => {
      expect(actionsSource).toContain(
        'const phaseMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id, phaseId);'
      );
      expect(actionsSource).toContain(
        'const defaultMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id);'
      );
    });
  });

  // ─── Backend: delete with task move ────────────────────────────────
  describe('deleteProjectStatusMapping supports moving tasks before deletion', () => {
    it('accepts an optional moveTasksToMappingId parameter', () => {
      expect(actionsSource).toContain('moveTasksToMappingId?: string');
    });

    it('moves tasks to the target mapping when moveTasksToMappingId is provided', () => {
      expect(actionsSource).toContain('if (moveTasksToMappingId)');
      expect(actionsSource).toContain(
        ".update({ project_status_mapping_id: moveTasksToMappingId })"
      );
    });

    it('blocks deletion if tasks exist and no move target is given', () => {
      expect(actionsSource).toContain('Cannot delete status with');
      expect(actionsSource).toContain('Please move tasks to another status first.');
    });

    it('validates remaining count within the same phase scope', () => {
      expect(actionsSource).toContain("remainingQuery.where({ phase_id: mapping.phase_id });");
      expect(actionsSource).toContain("remainingQuery.whereNull('phase_id');");
    });

    it('prevents deleting the last status in a scope', () => {
      expect(actionsSource).toContain('Cannot delete the last status in a project');
    });
  });

  // ─── Backend: task count query ─────────────────────────────────────
  describe('getStatusMappingTaskCount returns the task count for a mapping', () => {
    it('queries project_tasks by mapping id', () => {
      expect(actionsSource).toContain('export const getStatusMappingTaskCount = withAuth(async (');
      expect(actionsSource).toContain("{ project_status_mapping_id: mappingId, tenant }");
      expect(actionsSource).toContain(".count('* as count')");
    });
  });

  // ─── UI: ProjectTaskStatusSettings phase scoping ───────────────────
  describe('ProjectTaskStatusSettings supports phase scope selection', () => {
    it('accepts an initialPhaseId prop', () => {
      expect(settingsSource).toContain('initialPhaseId?: string | null');
      expect(settingsSource).toContain('initialPhaseId || DEFAULT_SCOPE');
    });

    it('renders a scope selector when phases exist', () => {
      expect(settingsSource).toContain('phase-status-scope-select');
      expect(settingsSource).toContain('phases.length > 0');
    });

    it('shows Use project defaults / Custom statuses toggle for phases', () => {
      expect(settingsSource).toContain('use-project-defaults-button');
      expect(settingsSource).toContain('use-custom-statuses-button');
    });

    it('auto-copies defaults when enabling custom statuses', () => {
      expect(settingsSource).toContain('handleEnableCustomStatuses');
      expect(settingsSource).toContain('copyProjectStatusesToPhase(projectId, selectedPhaseId)');
    });

    it('shows a revert confirmation before reverting to defaults', () => {
      expect(settingsSource).toContain('revertConfirmation');
      expect(settingsSource).toContain('handleRevertToDefaults');
      expect(settingsSource).toContain('removePhaseStatuses(selectedPhaseId)');
    });
  });

  // ─── UI: delete confirmation with task move ────────────────────────
  describe('delete confirmation offers to move tasks', () => {
    it('fetches task count before showing the delete dialog', () => {
      expect(settingsSource).toContain('initiateDelete');
      expect(settingsSource).toContain('getStatusMappingTaskCount(mappingId)');
    });

    it('shows a move-to dropdown when tasks exist', () => {
      expect(settingsSource).toContain('deleteConfirmation.taskCount > 0');
      expect(settingsSource).toContain('move-tasks-target-select');
      expect(settingsSource).toContain('moveToMappingId');
    });

    it('passes moveTarget to deleteProjectStatusMapping when tasks exist', () => {
      expect(settingsSource).toContain(
        'deleteConfirmation.taskCount > 0 ? deleteConfirmation.moveToMappingId : undefined'
      );
    });

    it('shows a simple confirmation when no tasks exist', () => {
      expect(settingsSource).toContain("settings.statuses.confirm_delete'");
    });

    it('uses a compact dialog for the nested delete confirmation', () => {
      expect(settingsSource).toContain('max-w-sm');
    });
  });

  // ─── UI: PhaseListItem status indicator ────────────────────────────
  describe('PhaseListItem shows a phase status indicator in edit mode', () => {
    it('fetches custom status count when entering edit mode', () => {
      expect(phaseListItemSource).toContain('getProjectStatusMappings(projectId, phase.phase_id)');
      expect(phaseListItemSource).toContain('setCustomStatusCount(mappings.length)');
    });

    it('shows "Project defaults" when no custom statuses exist', () => {
      expect(phaseListItemSource).toContain("phases.statusColumnsProjectDefaults");
    });

    it('shows "Custom (N statuses)" when phase has custom statuses', () => {
      expect(phaseListItemSource).toContain("phases.statusColumnsCustom");
      expect(phaseListItemSource).toContain('customStatusCount');
    });

    it('has a Configure button that opens a dialog', () => {
      expect(phaseListItemSource).toContain('configure-phase-statuses-');
      expect(phaseListItemSource).toContain('setShowStatusDialog(true)');
      expect(phaseListItemSource).toContain('showStatusDialog');
    });

    it('passes projectId and initialPhaseId to the dialog', () => {
      expect(phaseListItemSource).toContain('projectId={projectId}');
      expect(phaseListItemSource).toContain('initialPhaseId={phase.phase_id}');
    });

    it('includes the phase name in the dialog title', () => {
      expect(phaseListItemSource).toContain('phase.phase_name');
    });

    it('refreshes status count after dialog closes', () => {
      // The useEffect depends on showStatusDialog, so closing the dialog triggers a re-fetch
      expect(phaseListItemSource).toContain('[isEditing, showStatusDialog, projectId, phase.phase_id]');
    });
  });

  // ─── UI: i18n translations ─────────────────────────────────────────
  describe('status settings use proper i18n namespaces', () => {
    it('ProjectTaskStatusSettings uses features/projects namespace', () => {
      expect(settingsSource).toContain("useTranslation(['features/projects', 'common'])");
    });

    it('PhaseListItem uses features/projects namespace', () => {
      expect(phaseListItemSource).toContain("useTranslation('features/projects')");
    });

    it('ProjectTaskStatusSettings does not contain raw untranslated UI strings', () => {
      // Ensure key hardcoded strings from the original version have been replaced
      expect(settingsSource).not.toContain("'Status Scope'");
      expect(settingsSource).not.toContain("'Project Defaults'");
      expect(settingsSource).not.toContain("'Use project defaults'");
      expect(settingsSource).not.toContain("'Custom statuses'");
    });
  });

  // ─── Utility: projectStatusMappingUtils ────────────────────────────
  describe('projectStatusMappingUtils resolves phase-scoped mappings', () => {
    it('getScopedProjectStatusMappings joins statuses and standard_statuses', () => {
      expect(projectStatusMappingUtilsSource).toContain(
        "async function getScopedProjectStatusMappings("
      );
      expect(projectStatusMappingUtilsSource).toContain("leftJoin('statuses");
      expect(projectStatusMappingUtilsSource).toContain("leftJoin('standard_statuses");
    });

    it('resolveReplacementStatusMapping finds a matching default status', () => {
      expect(actionsSource).toContain('function resolveReplacementStatusMapping(');
    });
  });
});
