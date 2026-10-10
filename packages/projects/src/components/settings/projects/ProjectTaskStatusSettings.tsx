'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  addStatusToProject,
  copyProjectStatusesToPhase,
  deleteProjectStatusMapping,
  getProjectStatusMappings,
  getStatusMappingTaskCount,
  getTenantProjectStatuses,
  removePhaseStatuses,
  reorderProjectStatuses,
} from '@alga-psa/projects/actions/projectTaskStatusActions';
import { getProjectMetadata } from '@alga-psa/projects/actions/projectActions';
import type { IProjectPhase, IProjectStatusMapping, IStatus } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  AddStatusColumnControls,
  DeleteStatusColumnDialog,
  StatusColumnsEditor,
  type DeleteStatusColumnRequest,
} from '../../status-columns';

interface ProjectTaskStatusSettingsProps {
  projectId: string;
  initialPhaseId?: string | null;
}

const DEFAULT_SCOPE = '__project_defaults__';

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function mappingName(mapping: IProjectStatusMapping): string {
  return mapping.custom_name || mapping.status_name || mapping.name || 'Unnamed Status';
}

export function ProjectTaskStatusSettings({ projectId, initialPhaseId }: ProjectTaskStatusSettingsProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [statuses, setStatuses] = useState<IProjectStatusMapping[]>([]);
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [library, setLibrary] = useState<IStatus[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>(initialPhaseId || DEFAULT_SCOPE);
  const [hasCustomStatuses, setHasCustomStatuses] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteStatusColumnRequest | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  const [forkConfirmation, setForkConfirmation] = useState(false);

  const selectedPhaseId = selectedScope === DEFAULT_SCOPE ? null : selectedScope;

  // `silent` re-reads after a mutation without flashing the whole editor back
  // to a loading placeholder (which would tear down the open add picker).
  const loadStatuses = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const defaults = await getProjectStatusMappings(projectId);

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
      if (!silent) setLoading(false);
    }
  }, [projectId, selectedPhaseId]);

  const loadLibrary = useCallback(async () => {
    try {
      const data = await getTenantProjectStatuses();
      if (isReturnedActionError(data)) {
        toast.error(getErrorMessage(data));
        return;
      }
      setLibrary(data);
    } catch (error) {
      console.error('Failed to load tenant statuses:', error);
    }
  }, []);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    async function loadPhases() {
      try {
        const metadata = await getProjectMetadata(projectId);
        if (isReturnedActionError(metadata)) {
          toast.error(getErrorMessage(metadata));
          return;
        }
        if (metadata && 'phases' in metadata) {
          setPhases(metadata.phases);
        }
      } catch (error) {
        console.error('Failed to load project phases:', error);
      }
    }
    void loadPhases();
  }, [projectId]);

  const canMutateStatuses = !selectedPhaseId || hasCustomStatuses;
  const isUsingProjectDefaults = Boolean(selectedPhaseId) && !hasCustomStatuses;

  const items = useMemo(
    () => statuses.map((status) => ({
      id: status.project_status_mapping_id,
      name: mappingName(status),
      isClosed: Boolean(status.is_closed),
    })),
    [statuses]
  );

  const usedStatusIds = useMemo(
    () => new Set(statuses.map((status) => status.status_id).filter(Boolean) as string[]),
    [statuses]
  );
  const availableStatuses = useMemo(
    () => library.filter((status) => !usedStatusIds.has(status.status_id)),
    [library, usedStatusIds]
  );

  function applyOrder(orderedIds: string[]) {
    setStatuses((previous) => {
      const byId = new Map(previous.map((status) => [status.project_status_mapping_id, status]));
      return orderedIds
        .map((id) => byId.get(id))
        .filter((status): status is IProjectStatusMapping => Boolean(status));
    });
  }

  async function persistOrder(orderedIds: string[]) {
    if (!canMutateStatuses) return;
    const updates = orderedIds.map((id, index) => ({ mapping_id: id, display_order: index + 1 }));
    try {
      const result = await reorderProjectStatuses(projectId, updates, selectedPhaseId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await loadStatuses({ silent: true });
      }
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      await loadStatuses({ silent: true });
    }
  }

  async function initiateDelete(mappingId: string, statusName: string) {
    try {
      const taskCount = await getStatusMappingTaskCount(mappingId);
      if (isReturnedActionError(taskCount)) {
        toast.error(getErrorMessage(taskCount));
        return;
      }
      setDeleteRequest({ id: mappingId, name: statusName, taskCount });
    } catch (error) {
      console.error('Failed to check task count:', error);
      setDeleteRequest({ id: mappingId, name: statusName, taskCount: 0 });
    }
  }

  async function handleDelete(moveToMappingId?: string) {
    if (!deleteRequest) return;

    setIsMutating(true);
    try {
      const result = await deleteProjectStatusMapping(deleteRequest.id, moveToMappingId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('settings.statuses.removed_success', 'Status removed successfully'));
      setDeleteRequest(null);
      await loadStatuses({ silent: true });
    } catch (error) {
      console.error('Failed to delete status:', error);
      toast.error(t('settings.statuses.delete_error', 'Failed to delete status'));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleAddExisting(statusId: string) {
    setIsMutating(true);
    try {
      const result = await addStatusToProject(projectId, { status_id: statusId }, selectedPhaseId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('settings.statuses.added_success', 'Status added successfully'));
      await loadStatuses({ silent: true });
    } catch (error) {
      console.error('Failed to add status:', error);
      toast.error(t('settings.statuses.add_task_status_failed', 'Failed to add status'));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleStatusCreated(status: IStatus) {
    setLibrary((previous) => (previous.some((item) => item.status_id === status.status_id)
      ? previous
      : [...previous, status]));
    await handleAddExisting(status.status_id);
  }

  async function handleEnableCustomStatuses() {
    if (!selectedPhaseId || isMutating) return;

    setIsMutating(true);
    try {
      const result = await copyProjectStatusesToPhase(projectId, selectedPhaseId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      await loadStatuses();
    } catch (error) {
      console.error('Failed to copy project defaults to phase:', error);
      toast.error(t('settings.statuses.copy_failed'));
    } finally {
      setIsMutating(false);
      setForkConfirmation(false);
    }
  }

  async function handleRevertToDefaults() {
    if (!selectedPhaseId || !hasCustomStatuses) return;

    setIsMutating(true);
    try {
      const result = await removePhaseStatuses(selectedPhaseId);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      await loadStatuses();
    } catch (error) {
      console.error('Failed to remove phase statuses:', error);
      toast.error(t('settings.statuses.revert_failed'));
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

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings.statuses.project.title')}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('settings.statuses.arrange_hint')}
        </p>
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
                  onClick={() => setForkConfirmation(true)}
                  disabled={hasCustomStatuses || isMutating}
                  id="use-custom-statuses-button"
                >
                  {t('settings.statuses.custom_statuses')}
                </Button>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isUsingProjectDefaults
                  ? t('settings.statuses.phase_uses_defaults')
                  : t('settings.statuses.phase_uses_custom')}
              </p>
            </div>
          )}
        </div>
      )}

      <StatusColumnsEditor
        items={items}
        editable={canMutateStatuses}
        idPrefix="project-status"
        onReorder={applyOrder}
        onReorderCommit={persistOrder}
        onRequestDelete={(item) => void initiateDelete(item.id, item.name)}
        canDelete={() => statuses.length > 1}
        emptyState={(
          <div className="rounded-lg border-2 border-dashed p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <p className="font-medium">{t('settings.statuses.none_selected')}</p>
            <p>{t('settings.statuses.selector_none_selected_hint')}</p>
          </div>
        )}
      />

      {canMutateStatuses && (
        <AddStatusColumnControls
          availableStatuses={availableStatuses}
          existingStatuses={library}
          isBusy={isMutating}
          onRefresh={loadLibrary}
          onAddExisting={handleAddExisting}
          onStatusCreated={handleStatusCreated}
          idPrefix="project-status"
        />
      )}

      <DeleteStatusColumnDialog
        request={deleteRequest}
        moveTargets={statuses
          .filter((status) => status.project_status_mapping_id !== deleteRequest?.id)
          .map((status) => ({
            id: status.project_status_mapping_id,
            name: mappingName(status),
            isClosed: Boolean(status.is_closed),
          }))}
        isDeleting={isMutating}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={handleDelete}
        idPrefix="project-status"
      />

      {forkConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setForkConfirmation(false)}
          onConfirm={handleEnableCustomStatuses}
          title={t('settings.statuses.fork_title', 'Use custom status columns for this phase?')}
          message={t(
            'settings.statuses.fork_message',
            'This phase will stop inheriting the project default columns. Status columns you add to Project Defaults later will not appear here until you switch the phase back.'
          )}
          confirmLabel={t('settings.statuses.fork_confirm', 'Use custom statuses')}
          cancelLabel={t('common:actions.cancel')}
          id="confirm-phase-status-fork"
        />
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
          id="confirm-phase-status-revert"
        />
      )}
    </div>
  );
}
