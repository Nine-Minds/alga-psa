'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
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
  /** Fired whenever staged edits appear or clear, so the host can arm its Cancel prompt. */
  onPendingChangesChange?: (hasPendingChanges: boolean) => void;
}

/**
 * Staged edits (switching a phase between project defaults and its own
 * columns, plus column order) are written only when the host form saves, so
 * clicking a toggle to look around never changes live behaviour.
 */
export interface ProjectTaskStatusSettingsHandle {
  hasPendingChanges: () => boolean;
  /** Writes the staged edits. Returns false when something failed (already toasted). */
  commitPendingChanges: () => Promise<boolean>;
}

const DEFAULT_SCOPE = '__project_defaults__';

type PendingScopeMode = 'custom' | 'defaults';

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function mappingName(mapping: IProjectStatusMapping): string {
  return mapping.custom_name || mapping.status_name || mapping.name || 'Unnamed Status';
}

function omitKey<T>(source: Record<string, T>, key: string): Record<string, T> {
  const next = { ...source };
  delete next[key];
  return next;
}

export const ProjectTaskStatusSettings = forwardRef<
  ProjectTaskStatusSettingsHandle,
  ProjectTaskStatusSettingsProps
>(function ProjectTaskStatusSettings({ projectId, initialPhaseId, onPendingChangesChange }, ref) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [defaultStatuses, setDefaultStatuses] = useState<IProjectStatusMapping[]>([]);
  const [phaseStatuses, setPhaseStatuses] = useState<IProjectStatusMapping[]>([]);
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [library, setLibrary] = useState<IStatus[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>(initialPhaseId || DEFAULT_SCOPE);
  const [hasCustomStatuses, setHasCustomStatuses] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteStatusColumnRequest | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  const [forkConfirmation, setForkConfirmation] = useState(false);
  // Staged until the host saves: phase_id -> scope the phase will use.
  const [pendingScopeModes, setPendingScopeModes] = useState<Record<string, PendingScopeMode>>({});
  // Staged until the host saves: scope key -> column order.
  const [pendingOrders, setPendingOrders] = useState<Record<string, string[]>>({});

  const selectedPhaseId = selectedScope === DEFAULT_SCOPE ? null : selectedScope;
  const scopeKey = selectedPhaseId ?? DEFAULT_SCOPE;
  const pendingMode = selectedPhaseId ? pendingScopeModes[selectedPhaseId] : undefined;

  // `silent` re-reads after a mutation without flashing the whole editor back
  // to a loading placeholder (which would tear down the open add picker).
  const loadStatuses = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const defaults = await getProjectStatusMappings(projectId);
      setDefaultStatuses(defaults);

      if (selectedPhaseId) {
        const ownStatuses = await getProjectStatusMappings(projectId, selectedPhaseId);
        setPhaseStatuses(ownStatuses);
        setHasCustomStatuses(ownStatuses.length > 0);
      } else {
        setPhaseStatuses([]);
        setHasCustomStatuses(false);
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

  // A staged scope change previews the shared defaults, so nothing in the list
  // is editable until the host saves and the columns actually exist.
  const canMutateStatuses = !pendingMode && (!selectedPhaseId || hasCustomStatuses);
  const effectiveCustomStatuses = pendingMode ? pendingMode === 'custom' : hasCustomStatuses;
  const isUsingProjectDefaults = Boolean(selectedPhaseId) && !effectiveCustomStatuses;

  const baseStatuses = useMemo(() => {
    if (!selectedPhaseId || pendingMode) return defaultStatuses;
    return hasCustomStatuses ? phaseStatuses : defaultStatuses;
  }, [defaultStatuses, hasCustomStatuses, pendingMode, phaseStatuses, selectedPhaseId]);

  const statuses = useMemo(() => {
    const stagedOrder = pendingOrders[scopeKey];
    if (!stagedOrder) return baseStatuses;
    const byId = new Map(baseStatuses.map((status) => [status.project_status_mapping_id, status]));
    const ordered = stagedOrder
      .map((id) => byId.get(id))
      .filter((status): status is IProjectStatusMapping => Boolean(status));
    const remaining = baseStatuses.filter((status) => !stagedOrder.includes(status.project_status_mapping_id));
    return [...ordered, ...remaining];
  }, [baseStatuses, pendingOrders, scopeKey]);

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

  const hasPendingChanges =
    Object.keys(pendingScopeModes).length > 0 || Object.keys(pendingOrders).length > 0;

  useEffect(() => {
    onPendingChangesChange?.(hasPendingChanges);
  }, [hasPendingChanges, onPendingChangesChange]);

  function phaseName(phaseId: string): string {
    return phases.find((phase) => phase.phase_id === phaseId)?.phase_name ?? phaseId;
  }

  function scopeLabel(key: string): string {
    return key === DEFAULT_SCOPE ? t('settings.statuses.scope_project_defaults') : phaseName(key);
  }

  const pendingSummaries = [
    ...Object.entries(pendingScopeModes).map(([phaseId, mode]) => (mode === 'custom'
      ? t('settings.statuses.pending_fork', {
        phase: phaseName(phaseId),
        defaultValue: '{{phase}} will switch to its own status columns.',
      })
      : t('settings.statuses.pending_revert', {
        phase: phaseName(phaseId),
        defaultValue: '{{phase}} will go back to the project default columns.',
      }))),
    ...Object.keys(pendingOrders).map((key) => t('settings.statuses.pending_order', {
      scope: scopeLabel(key),
      defaultValue: 'New column order for {{scope}}.',
    })),
  ];

  // Local, unsaved reorder: used both for drag feedback and as the staged value.
  const stageOrder = useCallback((orderedIds: string[]) => {
    const serverOrder = baseStatuses.map((status) => status.project_status_mapping_id).join('|');
    setPendingOrders((previous) => (orderedIds.join('|') === serverOrder
      ? omitKey(previous, scopeKey)
      : { ...previous, [scopeKey]: orderedIds }));
  }, [baseStatuses, scopeKey]);

  const writeOrder = useCallback(async (key: string, orderedIds: string[]): Promise<boolean> => {
    const updates = orderedIds.map((id, index) => ({ mapping_id: id, display_order: index + 1 }));
    try {
      const result = await reorderProjectStatuses(projectId, updates, key === DEFAULT_SCOPE ? null : key);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      toast.error(t('settings.statuses.reorder_failed'));
      return false;
    }
  }, [projectId, t]);

  // Adding or deleting a column writes immediately, so a staged order for the
  // same scope has to land first or the server re-read would discard it.
  async function flushScopeOrder() {
    const stagedOrder = pendingOrders[scopeKey];
    if (!stagedOrder) return;
    if (await writeOrder(scopeKey, stagedOrder)) {
      setPendingOrders((previous) => omitKey(previous, scopeKey));
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
      await flushScopeOrder();
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
      await flushScopeOrder();
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

  // Both directions only stage: the phase keeps inheriting (or keeps its own
  // columns) until the host form saves, so exploring the toggles is free.
  function stagePhaseScope(mode: PendingScopeMode) {
    if (!selectedPhaseId) return;
    const persistedMode: PendingScopeMode = hasCustomStatuses ? 'custom' : 'defaults';
    setPendingScopeModes((previous) => (mode === persistedMode
      ? omitKey(previous, selectedPhaseId)
      : { ...previous, [selectedPhaseId]: mode }));
    // A scope switch replaces the phase's columns, so any staged order for it is moot.
    setPendingOrders((previous) => omitKey(previous, selectedPhaseId));
    setForkConfirmation(false);
    setRevertConfirmation(false);
  }

  function handleEnableCustomStatuses() {
    stagePhaseScope('custom');
  }

  function handleRevertToDefaults() {
    stagePhaseScope('defaults');
  }

  const commitPendingChanges = useCallback(async (): Promise<boolean> => {
    const scopeEntries = Object.entries(pendingScopeModes);
    const orderEntries = Object.entries(pendingOrders);
    if (scopeEntries.length === 0 && orderEntries.length === 0) return true;

    setIsMutating(true);
    let succeeded = true;
    try {
      for (const [phaseId, mode] of scopeEntries) {
        try {
          const result = mode === 'custom'
            ? await copyProjectStatusesToPhase(projectId, phaseId)
            : await removePhaseStatuses(phaseId);
          if (isReturnedActionError(result)) {
            toast.error(getErrorMessage(result));
            succeeded = false;
            continue;
          }
        } catch (error) {
          console.error('Failed to change phase status scope:', error);
          toast.error(mode === 'custom'
            ? t('settings.statuses.copy_failed')
            : t('settings.statuses.revert_failed'));
          succeeded = false;
          continue;
        }
        setPendingScopeModes((previous) => omitKey(previous, phaseId));
      }

      for (const [key, orderedIds] of orderEntries) {
        // A scope switch just rewrote this phase's columns with fresh ids.
        if (pendingScopeModes[key]) continue;
        if (!(await writeOrder(key, orderedIds))) {
          succeeded = false;
          continue;
        }
        setPendingOrders((previous) => omitKey(previous, key));
      }

      await loadStatuses({ silent: true });
      return succeeded;
    } finally {
      setIsMutating(false);
    }
  }, [loadStatuses, pendingOrders, pendingScopeModes, projectId, t, writeOrder]);

  useImperativeHandle(ref, () => ({
    hasPendingChanges: () => hasPendingChanges,
    commitPendingChanges,
  }), [commitPendingChanges, hasPendingChanges]);

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

      {pendingSummaries.length > 0 && (
        <div
          id="project-status-pending-banner"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">
                {t('settings.statuses.pending_title', 'Unsaved status column changes')}
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {pendingSummaries.map((summary) => (
                  <li key={summary}>{summary}</li>
                ))}
              </ul>
              <p>{t('settings.statuses.pending_apply_hint', 'Nothing changes until you save.')}</p>
            </div>
          </div>
        </div>
      )}

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
                  onClick={() => {
                    // Dropping a staged fork changes nothing server-side, so it needs no confirmation.
                    if (pendingMode === 'custom' && !hasCustomStatuses) {
                      stagePhaseScope('defaults');
                      return;
                    }
                    setRevertConfirmation(true);
                  }}
                  disabled={isUsingProjectDefaults || isMutating}
                  id="use-project-defaults-button"
                >
                  {t('settings.statuses.use_project_defaults')}
                </Button>
                <Button
                  variant={!isUsingProjectDefaults ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    if (pendingMode === 'defaults' && hasCustomStatuses) {
                      stagePhaseScope('custom');
                      return;
                    }
                    setForkConfirmation(true);
                  }}
                  disabled={effectiveCustomStatuses || isMutating}
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

              {pendingMode && (
                <p className="text-xs text-gray-500 dark:text-gray-400" id="phase-status-pending-preview-hint">
                  {t(
                    'settings.statuses.pending_preview_hint',
                    'Showing the project default columns as a preview. Save to apply this switch, then add or remove columns here.'
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <StatusColumnsEditor
        items={items}
        editable={canMutateStatuses}
        idPrefix="project-status"
        onReorder={stageOrder}
        onReorderCommit={stageOrder}
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
          message={`${t(
            'settings.statuses.fork_message',
            'This phase will stop inheriting the project default columns. Status columns you add to Project Defaults later will not appear here until you switch the phase back.'
          )} ${t('settings.statuses.pending_apply_hint', 'Nothing changes until you save.')}`}
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
          message={`${t('settings.statuses.revert_message')} ${t('settings.statuses.pending_apply_hint', 'Nothing changes until you save.')}`}
          confirmLabel={t('settings.statuses.revert_confirm')}
          cancelLabel={t('common:actions.cancel')}
          id="confirm-phase-status-revert"
        />
      )}
    </div>
  );
});
