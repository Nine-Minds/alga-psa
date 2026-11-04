'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Circle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IProjectTemplatePhase, IProjectTemplateStatusMapping } from '@alga-psa/types';
import {
  addTemplateStatusMapping,
  copyTemplateStatusesToPhase,
  removeTemplateStatusMapping,
  removeTemplatePhaseStatuses,
  reorderTemplateStatusMappings,
  replaceTemplateStatusMapping,
} from '../../actions/projectTemplateActions';
import { createTenantProjectStatus } from '../../actions/projectTaskStatusActions';
import { toast } from 'react-hot-toast';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { QuickAddStatus } from '@alga-psa/ui/components/QuickAddStatus';
import type { IStatus } from '@alga-psa/types';
import {
  DeleteStatusColumnDialog,
  StatusColumnName,
  StatusColumnsEditor,
  type DeleteStatusColumnRequest,
} from '../status-columns';
import {
  getEffectiveTemplateStatusMappings,
  getTemplateDefaultStatusMappings,
  getTemplatePhaseStatusMappings,
  TEMPLATE_DEFAULT_SCOPE,
} from '../../lib/templateStatusMappingUtils';

interface TemplateStatusManagerProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
  phases: IProjectTemplatePhase[];
  statusMappings: IProjectTemplateStatusMapping[];
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  /** Task count per template_status_mapping_id */
  taskCountByMapping?: Record<string, number>;
  onStatusAdded: (mapping: IProjectTemplateStatusMapping) => void;
  onStatusRemoved: (mappingId: string, moveTasksToMappingId?: string) => void;
  onPhaseStatusesRemoved?: (templatePhaseId: string) => void;
  onStatusReordered: (orderedMappingIds: string[], templatePhaseId?: string | null) => void;
  onStatusReplaced?: (result: {
    mapping: IProjectTemplateStatusMapping;
    unresolvedStatusMappingCount: number;
  }) => void;
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function unwrapTemplateActionResult<T>(value: T | { actionError: string } | { permissionError: string }): T {
  if (isReturnedActionError(value)) {
    throw new Error(getErrorMessage(value));
  }
  return value;
}

export function TemplateStatusManager({
  open,
  onClose,
  templateId,
  phases,
  statusMappings,
  availableStatuses,
  taskCountByMapping = {},
  onStatusAdded,
  onStatusRemoved,
  onPhaseStatusesRemoved,
  onStatusReordered,
  onStatusReplaced,
}: TemplateStatusManagerProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);
  const [localAvailableStatuses, setLocalAvailableStatuses] = useState(availableStatuses);
  const [removeConfirmation, setRemoveConfirmation] = useState<DeleteStatusColumnRequest | null>(null);
  const [resetToDefaultsConfirmation, setResetToDefaultsConfirmation] = useState(false);
  const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);

  useEffect(() => {
    setLocalAvailableStatuses(availableStatuses);
  }, [availableStatuses]);

  const selectedTemplatePhaseId = selectedScope === TEMPLATE_DEFAULT_SCOPE ? null : selectedScope;
  const defaultStatusMappings = useMemo(
    () => getTemplateDefaultStatusMappings(statusMappings),
    [statusMappings]
  );
  const phaseStatusMappings = useMemo(
    () => getTemplatePhaseStatusMappings(statusMappings, selectedTemplatePhaseId),
    [selectedTemplatePhaseId, statusMappings]
  );
  const hasPhaseSpecificStatuses = selectedTemplatePhaseId !== null && phaseStatusMappings.length > 0;
  const isUsingTemplateDefaults = selectedTemplatePhaseId !== null && !hasPhaseSpecificStatuses;
  const editableMappings = hasPhaseSpecificStatuses || selectedTemplatePhaseId === null;
  const sortedMappings = useMemo(
    () => getEffectiveTemplateStatusMappings(statusMappings, selectedTemplatePhaseId),
    [selectedTemplatePhaseId, statusMappings]
  );

  const usedStatusIds = new Set(
    (hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings)
      .map((mapping) => mapping.status_id)
      .filter(Boolean)
  );
  const unusedStatuses = localAvailableStatuses.filter((s) => !usedStatusIds.has(s.status_id));
  const selectedScopeLabel = selectedTemplatePhaseId
    ? phases.find((phase) => phase.template_phase_id === selectedTemplatePhaseId)?.phase_name || 'Phase'
    : t('settings.statuses.scope_project_defaults');

  const handleAddStatus = async () => {
    if (!selectedStatusId || !editableMappings) return;

    setIsAdding(true);
    try {
      const newMapping = unwrapTemplateActionResult(await addTemplateStatusMapping(
        templateId,
        { status_id: selectedStatusId },
        selectedTemplatePhaseId
      ));
      onStatusAdded(newMapping);
      setSelectedStatusId('');
      toast.success(t('templates.statuses.added'));
    } catch (error) {
      handleError(error, 'Failed to add status column');
    } finally {
      setIsAdding(false);
    }
  };

  const initiateRemove = (mappingId: string) => {
    const mapping = sortedMappings.find(m => m.template_status_mapping_id === mappingId);
    setRemoveConfirmation({
      id: mappingId,
      name: mapping?.status_name || mapping?.custom_status_name || 'Status',
      taskCount: taskCountByMapping[mappingId] || 0,
    });
  };

  const handleRemoveStatus = async (moveToMappingId?: string) => {
    if (!removeConfirmation) return;
    try {
      unwrapTemplateActionResult(await removeTemplateStatusMapping(removeConfirmation.id));
      onStatusRemoved(removeConfirmation.id, moveToMappingId);
      toast.success(t('templates.statuses.removed'));
    } catch (error) {
      handleError(error, 'Failed to remove status column');
    } finally {
      setRemoveConfirmation(null);
    }
  };

  const handleReorder = (orderedIds: string[]) => {
    onStatusReordered(orderedIds, selectedTemplatePhaseId);
  };

  const handleReorderCommit = async (orderedIds: string[]) => {
    try {
      unwrapTemplateActionResult(await reorderTemplateStatusMappings(templateId, orderedIds, selectedTemplatePhaseId));
    } catch (error) {
      handleError(error, 'Failed to reorder status columns');
    }
  };

  const handleEnableCustomStatuses = async () => {
    if (!selectedTemplatePhaseId) return;

    try {
      const copiedMappings = unwrapTemplateActionResult(await copyTemplateStatusesToPhase(templateId, selectedTemplatePhaseId));
      copiedMappings.forEach((mapping) => onStatusAdded(mapping));
      toast.success(t('templates.statuses.copied_to_phase'));
    } catch (error) {
      handleError(error, 'Failed to copy template defaults');
    }
  };

  const handleResetPhaseToDefaults = async () => {
    if (!selectedTemplatePhaseId) return;

    try {
      unwrapTemplateActionResult(await removeTemplatePhaseStatuses(templateId, selectedTemplatePhaseId));
      onPhaseStatusesRemoved?.(selectedTemplatePhaseId);
      toast.success(t('templates.statuses.reverted'));
    } catch (error) {
      handleError(error, 'Failed to revert phase statuses');
    } finally {
      setResetToDefaultsConfirmation(false);
    }
  };

  const handleNewStatusCreated = async (newStatus: IStatus) => {
    setLocalAvailableStatuses((prev) => [
      ...prev,
      {
        status_id: newStatus.status_id,
        name: newStatus.name,
        color: newStatus.color || undefined,
        is_closed: newStatus.is_closed,
      },
    ]);

    if (!editableMappings) return;

    setIsAdding(true);
    try {
      const newMapping = unwrapTemplateActionResult(await addTemplateStatusMapping(
        templateId,
        { status_id: newStatus.status_id },
        selectedTemplatePhaseId
      ));
      onStatusAdded(newMapping);
      toast.success(t('templates.statuses.added'));
    } catch (error) {
      handleError(error, 'Failed to add status column');
    } finally {
      setIsAdding(false);
    }
  };

  const [replaceTargetByMapping, setReplaceTargetByMapping] = useState<Record<string, string>>({});
  const [replacingMappingId, setReplacingMappingId] = useState<string | null>(null);

  const handleReplaceStatus = async (mappingId: string) => {
    const targetStatusId = replaceTargetByMapping[mappingId];
    if (!targetStatusId) return;

    setReplacingMappingId(mappingId);
    try {
      const result = unwrapTemplateActionResult(await replaceTemplateStatusMapping(
        templateId,
        mappingId,
        { type: 'tenant', statusId: targetStatusId }
      ));
      onStatusReplaced?.(result);
      toast.success(t('templates.statuses.replaced'));
    } catch (error) {
      handleError(error, t('templates.statuses.replace_failed'));
    } finally {
      setReplacingMappingId(null);
    }
  };

  return (
    <>
      {resetToDefaultsConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setResetToDefaultsConfirmation(false)}
          onConfirm={handleResetPhaseToDefaults}
          title={t('settings.statuses.revert_title')}
          message={t('templates.statuses.revert_message')}
          confirmLabel={t('settings.statuses.revert_confirm')}
          cancelLabel={t('common:actions.cancel')}
        />
      )}

      <DeleteStatusColumnDialog
        request={removeConfirmation}
        moveTargets={sortedMappings
          .filter(m => m.template_status_mapping_id !== removeConfirmation?.id)
          .map(m => ({
            id: m.template_status_mapping_id,
            name: m.status_name || m.custom_status_name || 'Status',
          }))}
        onCancel={() => setRemoveConfirmation(null)}
        onConfirm={handleRemoveStatus}
        idPrefix="template-status"
      />

      <Dialog
        isOpen={open}
        onClose={onClose}
        title={t('templates.statuses.manage_title')}
        className="max-w-lg"
        id="template-status-manager-dialog"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('templates.statuses.manage_description')}
            </p>

            {phases.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.statuses.scope_label')}
                </label>
                <CustomSelect
                  value={selectedScope}
                  onValueChange={setSelectedScope}
                  options={[
                    { value: TEMPLATE_DEFAULT_SCOPE, label: t('templates.statuses.template_defaults') },
                    ...phases.map((phase) => ({
                      value: phase.template_phase_id,
                      label: phase.phase_name,
                    })),
                  ]}
                />
              </div>
            )}

            {selectedTemplatePhaseId && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant={isUsingTemplateDefaults ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setResetToDefaultsConfirmation(true)}
                    disabled={isUsingTemplateDefaults}
                    id="use-template-default-statuses"
                  >
                    {t('settings.statuses.use_project_defaults')}
                  </Button>
                  <Button
                    variant={!isUsingTemplateDefaults ? 'default' : 'outline'}
                    size="sm"
                    onClick={handleEnableCustomStatuses}
                    disabled={hasPhaseSpecificStatuses}
                    id="copy-template-default-statuses"
                  >
                    {t('settings.statuses.custom_statuses')}
                  </Button>
                </div>
                {isUsingTemplateDefaults && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.statuses.phase_uses_defaults')}
                  </p>
                )}
              </div>
            )}

            {/* Current Status Columns */}
            <StatusColumnsEditor
              items={sortedMappings.map((mapping) => ({
                id: mapping.template_status_mapping_id,
                name: mapping.status_name || mapping.custom_status_name || 'Status',
                isClosed: localAvailableStatuses.find((s) => s.status_id === mapping.status_id)?.is_closed,
                color: mapping.color || null,
              }))}
              editable={editableMappings}
              showColor
              idPrefix="template-status"
              onReorder={handleReorder}
              onReorderCommit={handleReorderCommit}
              onRequestDelete={(item) => initiateRemove(item.id)}
              canDelete={() => sortedMappings.length > 1}
              renderRowBody={(item, index) => {
                const mapping = sortedMappings[index];
                if (mapping?.statusSource !== 'unresolved') {
                  return <StatusColumnName name={item.name} isClosed={item.isClosed} className="font-medium" />;
                }
                return (
                  <div>
                    <span className="font-medium text-destructive">
                      {t('templates.statuses.status_no_longer_exists')}
                    </span>
                    <p className="text-xs text-gray-500">
                      {mapping.unresolved_reason === 'ambiguous'
                        ? t('templates.statuses.ambiguous_status')
                        : t('templates.statuses.missing_status')}
                    </p>
                  </div>
                );
              }}
              renderRowExtra={(item, index) => {
                if (sortedMappings[index]?.statusSource !== 'unresolved') return null;
                return (
                  <div className="mt-2 flex items-center gap-2 pl-8">
                    <CustomSelect
                      value={replaceTargetByMapping[item.id] || ''}
                      onValueChange={(value) => setReplaceTargetByMapping((prev) => ({
                        ...prev,
                        [item.id]: value,
                      }))}
                      options={[
                        { value: '', label: t('templates.statuses.replace_placeholder') },
                        ...localAvailableStatuses.map((s) => ({
                          value: s.status_id,
                          label: `${s.name}${s.is_closed ? ` ${t('settings.statuses.closed_badge')}` : ''}`,
                        })),
                      ]}
                      disabled={replacingMappingId === item.id}
                      className="flex-1"
                    />
                    <Button
                      id={`replace-status-${item.id}`}
                      size="sm"
                      onClick={() => handleReplaceStatus(item.id)}
                      disabled={!replaceTargetByMapping[item.id] || replacingMappingId === item.id}
                    >
                      {replacingMappingId === item.id
                        ? t('templates.statuses.replacing')
                        : t('templates.statuses.replace_status')}
                    </Button>
                  </div>
                );
              }}
              emptyState={(
                <div className="text-center py-6 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] rounded-lg border-2 border-dashed">
                  <Circle className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600 dark:text-gray-400">{t('templates.statuses.empty')}</p>
                  <p className="text-sm text-gray-500">{t('templates.statuses.empty_hint')}</p>
                </div>
              )}
            />

            {/* Add Status */}
            {editableMappings && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-2">{t('templates.statuses.add_title')}</h4>
                <div className="flex gap-2">
                  {unusedStatuses.length > 0 ? (
                    <>
                      <CustomSelect
                        value={selectedStatusId}
                        onValueChange={setSelectedStatusId}
                        options={[
                          { value: '', label: t('templates.statuses.select_placeholder') },
                          ...unusedStatuses.map((s) => ({
                            value: s.status_id,
                            label: `${s.name}${s.is_closed ? ` ${t('settings.statuses.closed_badge')}` : ''}`,
                          })),
                        ]}
                        disabled={isAdding}
                        className="flex-1"
                      />
                      <Button
                        id="add-existing-status"
                        onClick={handleAddStatus}
                        disabled={!selectedStatusId || isAdding}
                      >
                        {t('settings.statuses.add_existing', 'Add Existing')}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 flex-1">{t('templates.statuses.all_in_use')}</p>
                  )}
                  <Button
                    id="create-new-status"
                    variant="outline"
                    onClick={() => setShowQuickAddStatus(true)}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {t('templates.statuses.create_new')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button id="close-status-manager" onClick={onClose}>
              {t('common:actions.done', { defaultValue: 'Done' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickAddStatus
        open={showQuickAddStatus}
        onOpenChange={setShowQuickAddStatus}
        onStatusCreated={handleNewStatusCreated}
        statusType="project_task"
        createStatus={async ({ name, isClosed, color }) =>
          createTenantProjectStatus({ name, is_closed: isClosed, color })
        }
        existingStatuses={localAvailableStatuses}
      />
    </>
  );
}
