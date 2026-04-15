'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { AddStatusDialog } from './AddStatusDialog';
import {
  getProjectStatusMappings,
  getStatusMappingTaskCount,
  deleteProjectStatusMapping,
  reorderProjectStatuses,
  copyProjectStatusesToPhase,
  removePhaseStatuses
} from '@alga-psa/projects/actions/projectTaskStatusActions';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { getProjectMetadata } from '@alga-psa/projects/actions/projectActions';
import type { IProjectPhase, IProjectStatusMapping } from '@alga-psa/types';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface ProjectTaskStatusSettingsProps {
  projectId: string;
  initialPhaseId?: string | null;
}

const DEFAULT_SCOPE = '__project_defaults__';

export function ProjectTaskStatusSettings({ projectId, initialPhaseId }: ProjectTaskStatusSettingsProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [statuses, setStatuses] = useState<IProjectStatusMapping[]>([]);
  const [projectDefaultStatuses, setProjectDefaultStatuses] = useState<IProjectStatusMapping[]>([]);
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>(initialPhaseId || DEFAULT_SCOPE);
  const [hasCustomStatuses, setHasCustomStatuses] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    mappingId: string;
    statusName: string;
    taskCount: number;
    moveToMappingId: string;
  } | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState(false);

  const selectedPhaseId = selectedScope === DEFAULT_SCOPE ? null : selectedScope;

  useEffect(() => {
    loadStatuses();
  }, [projectId, selectedScope]);

  useEffect(() => {
    loadPhases();
  }, [projectId]);


  async function loadPhases() {
    try {
      const metadata = await getProjectMetadata(projectId);
      if (metadata && 'phases' in metadata) {
        setPhases(metadata.phases);
      }
    } catch (error) {
      console.error('Failed to load project phases:', error);
    }
  }

  async function loadStatuses() {
    setLoading(true);
    try {
      const defaults = await getProjectStatusMappings(projectId);
      setProjectDefaultStatuses(defaults);

      if (selectedPhaseId) {
        const phaseStatuses = await getProjectStatusMappings(projectId, selectedPhaseId);
        const phaseHasCustomStatuses = phaseStatuses.length > 0;
        setHasCustomStatuses(phaseHasCustomStatuses);
        setStatuses(phaseHasCustomStatuses ? phaseStatuses : defaults);
      } else {
        setHasCustomStatuses(true);
        setStatuses(defaults);
      }
    } catch (error) {
      console.error('Failed to load statuses:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    if (selectedPhaseId && !hasCustomStatuses) return;

    const newStatuses = [...statuses];
    [newStatuses[index - 1], newStatuses[index]] = [newStatuses[index], newStatuses[index - 1]];

    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates, selectedPhaseId);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses();
    }
  }

  async function handleMoveDown(index: number) {
    if (index === statuses.length - 1) return;
    if (selectedPhaseId && !hasCustomStatuses) return;

    const newStatuses = [...statuses];
    [newStatuses[index], newStatuses[index + 1]] = [newStatuses[index + 1], newStatuses[index]];

    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates, selectedPhaseId);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses();
    }
  }

  async function initiateDelete(mappingId: string, statusName: string) {
    try {
      const taskCount = await getStatusMappingTaskCount(mappingId);
      // Find the first other status to default the move target
      const otherStatuses = statuses.filter(s => s.project_status_mapping_id !== mappingId);
      setDeleteConfirmation({
        mappingId,
        statusName,
        taskCount,
        moveToMappingId: otherStatuses[0]?.project_status_mapping_id || '',
      });
    } catch (error) {
      console.error('Failed to check task count:', error);
      setDeleteConfirmation({ mappingId, statusName, taskCount: 0, moveToMappingId: '' });
    }
  }

  async function handleDelete() {
    if (!deleteConfirmation) return;

    setIsMutating(true);
    try {
      const moveTarget = deleteConfirmation.taskCount > 0 ? deleteConfirmation.moveToMappingId : undefined;
      await deleteProjectStatusMapping(deleteConfirmation.mappingId, moveTarget);
      await loadStatuses();
    } catch (error: any) {
      console.error('Failed to delete status:', error);
    } finally {
      setIsMutating(false);
      setDeleteConfirmation(null);
    }
  }

  async function handleEnableCustomStatuses() {
    if (!selectedPhaseId || isMutating) return;

    setIsMutating(true);
    try {
      await copyProjectStatusesToPhase(projectId, selectedPhaseId);
      await loadStatuses();
    } catch (error) {
      console.error('Failed to copy project defaults to phase:', error);
      alert(t('settings.statuses.copy_failed'));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRevertToDefaults() {
    if (!selectedPhaseId || !hasCustomStatuses) return;

    setIsMutating(true);
    try {
      await removePhaseStatuses(selectedPhaseId);
      await loadStatuses();
    } catch (error) {
      console.error('Failed to remove phase statuses:', error);
      alert(t('settings.statuses.revert_failed'));
    } finally {
      setIsMutating(false);
      setRevertConfirmation(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">{t('common:status.loading')}</div>;
  }

  const scopeOptions = [
    { value: DEFAULT_SCOPE, label: t('settings.statuses.scope_project_defaults') },
    ...phases.map((phase) => ({
      value: phase.phase_id,
      label: phase.phase_name
    }))
  ];

  const isUsingProjectDefaults = Boolean(selectedPhaseId) && !hasCustomStatuses;
  const canMutateStatuses = !selectedPhaseId || hasCustomStatuses;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings.statuses.project.title')}
        </label>
        <Button
          onClick={() => setShowAddDialog(true)}
          size="sm"
          variant="outline"
          id="add-status-button"
          disabled={Boolean(selectedPhaseId) && !hasCustomStatuses}
        >
          {t('settings.statuses.project.add_from_library')}
        </Button>
      </div>

      {phases.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-gray-50 dark:bg-[rgb(var(--color-border-50))] p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('settings.statuses.scope_label')}
            </label>
            <CustomSelect
              value={selectedScope}
              onValueChange={setSelectedScope}
              options={scopeOptions}
              placeholder={t('settings.statuses.scope_placeholder')}
              id="phase-status-scope-select"
            />
          </div>

          {selectedPhaseId && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  variant={isUsingProjectDefaults ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRevertConfirmation(true)}
                  disabled={isUsingProjectDefaults || isMutating}
                  id="use-project-defaults-button"
                >
                  {t('settings.statuses.use_project_defaults')}
                </Button>
                <Button
                  variant={!isUsingProjectDefaults ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleEnableCustomStatuses}
                  id="use-custom-statuses-button"
                >
                  {t('settings.statuses.custom_statuses')}
                </Button>
              </div>

              {isUsingProjectDefaults && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.statuses.phase_uses_defaults')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        {statuses.map((status, index) => {
          const displayName = status.custom_name || status.status_name || status.name || 'Unnamed Status';
          return (
            <div
              key={status.project_status_mapping_id}
              className="flex items-center justify-between p-3 bg-white dark:bg-[rgb(var(--color-card))] border rounded-lg"
            >
              <div className="flex items-center gap-2 flex-1">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || !canMutateStatuses}
                    className="p-0.5 hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                    id={`move-up-${status.project_status_mapping_id}`}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === statuses.length - 1 || !canMutateStatuses}
                    className="p-0.5 hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                    id={`move-down-${status.project_status_mapping_id}`}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                <div>
                  <span className="text-sm font-medium">{displayName}</span>
                  {status.is_closed && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                      {t('settings.statuses.closed')}
                    </span>
                  )}
                </div>
              </div>
              {canMutateStatuses && (
                <button
                  onClick={() => initiateDelete(status.project_status_mapping_id, displayName)}
                  className="p-1 hover:bg-destructive/15 rounded text-destructive"
                  title={t('common:actions.delete')}
                  id={`delete-status-${status.project_status_mapping_id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showAddDialog && (
        <AddStatusDialog
          projectId={projectId}
          phaseId={selectedPhaseId}
          onClose={() => setShowAddDialog(false)}
          onAdded={loadStatuses}
        />
      )}

      {deleteConfirmation && (
        <Dialog
          isOpen={true}
          onClose={() => setDeleteConfirmation(null)}
          title={t('settings.statuses.confirm_delete_title')}
          className="max-w-sm"
        >
          <div className="space-y-4">
            {deleteConfirmation.taskCount > 0 ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('settings.statuses.delete_has_tasks', {
                    statusName: deleteConfirmation.statusName,
                    count: deleteConfirmation.taskCount,
                    defaultValue: '"{{statusName}}" has {{count}} task(s). Move them to:',
                  })}
                </p>
                <CustomSelect
                  value={deleteConfirmation.moveToMappingId}
                  onValueChange={(val) => setDeleteConfirmation({ ...deleteConfirmation, moveToMappingId: val })}
                  options={statuses
                    .filter(s => s.project_status_mapping_id !== deleteConfirmation.mappingId)
                    .map(s => ({
                      value: s.project_status_mapping_id,
                      label: s.custom_name || s.status_name || s.name || 'Status',
                    }))}
                  id="move-tasks-target-select"
                />
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('settings.statuses.confirm_delete', { statusName: deleteConfirmation.statusName })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button id="cancel-delete-status" variant="outline" size="sm" onClick={() => setDeleteConfirmation(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                id="confirm-delete-status"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isMutating || (deleteConfirmation.taskCount > 0 && !deleteConfirmation.moveToMappingId)}
              >
                {deleteConfirmation.taskCount > 0
                  ? t('settings.statuses.delete_and_move', { defaultValue: 'Move & Delete' })
                  : t('common:actions.delete')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {revertConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setRevertConfirmation(false)}
          onConfirm={handleRevertToDefaults}
          title={t('settings.statuses.revert_title')}
          message={t('settings.statuses.revert_message')}
          confirmLabel={t('settings.statuses.revert_confirm')}
          cancelLabel={t('common:actions.cancel')}
        />
      )}
    </div>
  );
}
