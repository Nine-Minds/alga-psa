'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Trash, GripVertical, Circle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IProjectTemplatePhase, IProjectTemplateStatusMapping } from '@alga-psa/types';
import {
  addTemplateStatusMapping,
  copyTemplateStatusesToPhase,
  removeTemplateStatusMapping,
  removeTemplatePhaseStatuses,
  reorderTemplateStatusMappings,
} from '../../actions/projectTemplateActions';
import { createTenantProjectStatus } from '../../actions/projectTaskStatusActions';
import { toast } from 'react-hot-toast';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { QuickAddStatus } from '@alga-psa/ui/components/QuickAddStatus';
import type { IStatus } from '@alga-psa/types';
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
}: TemplateStatusManagerProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);
  const [localAvailableStatuses, setLocalAvailableStatuses] = useState(availableStatuses);
  const [removeConfirmation, setRemoveConfirmation] = useState<{
    mappingId: string;
    statusName: string;
    taskCount: number;
    moveToMappingId: string;
  } | null>(null);
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
      const newMapping = await addTemplateStatusMapping(
        templateId,
        { status_id: selectedStatusId },
        selectedTemplatePhaseId
      );
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
    const statusName = mapping?.status_name || mapping?.custom_status_name || 'Status';
    const taskCount = taskCountByMapping[mappingId] || 0;
    const otherMappings = sortedMappings.filter(m => m.template_status_mapping_id !== mappingId);
    setRemoveConfirmation({
      mappingId,
      statusName,
      taskCount,
      moveToMappingId: otherMappings[0]?.template_status_mapping_id || '',
    });
  };

  const handleRemoveStatus = async () => {
    if (!removeConfirmation) return;
    try {
      const moveTarget = removeConfirmation.taskCount > 0 ? removeConfirmation.moveToMappingId : undefined;
      await removeTemplateStatusMapping(removeConfirmation.mappingId);
      onStatusRemoved(removeConfirmation.mappingId, moveTarget);
      toast.success(t('templates.statuses.removed'));
    } catch (error) {
      handleError(error, 'Failed to remove status column');
    } finally {
      setRemoveConfirmation(null);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const items = [...sortedMappings];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    const orderedIds = items.map((m) => m.template_status_mapping_id);
    onStatusReordered(orderedIds, selectedTemplatePhaseId);
    setDraggedIndex(targetIndex);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const orderedIds = sortedMappings.map((m) => m.template_status_mapping_id);
      await reorderTemplateStatusMappings(templateId, orderedIds, selectedTemplatePhaseId);
    } catch (error) {
      handleError(error, 'Failed to reorder status columns');
    } finally {
      setDraggedIndex(null);
    }
  };

  const handleEnableCustomStatuses = async () => {
    if (!selectedTemplatePhaseId) return;

    try {
      const copiedMappings = await copyTemplateStatusesToPhase(templateId, selectedTemplatePhaseId);
      copiedMappings.forEach((mapping) => onStatusAdded(mapping));
      toast.success(t('templates.statuses.copied_to_phase'));
    } catch (error) {
      handleError(error, 'Failed to copy template defaults');
    }
  };

  const handleResetPhaseToDefaults = async () => {
    if (!selectedTemplatePhaseId) return;

    try {
      await removeTemplatePhaseStatuses(templateId, selectedTemplatePhaseId);
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
      const newMapping = await addTemplateStatusMapping(
        templateId,
        { status_id: newStatus.status_id },
        selectedTemplatePhaseId
      );
      onStatusAdded(newMapping);
      toast.success(t('templates.statuses.added'));
    } catch (error) {
      handleError(error, 'Failed to add status column');
    } finally {
      setIsAdding(false);
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

      {removeConfirmation && (
        <Dialog
          isOpen={true}
          onClose={() => setRemoveConfirmation(null)}
          title={t('templates.statuses.remove_title')}
          className="max-w-sm"
        >
          <div className="space-y-4">
            {removeConfirmation.taskCount > 0 ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('settings.statuses.delete_has_tasks', {
                    statusName: removeConfirmation.statusName,
                    count: removeConfirmation.taskCount,
                  })}
                </p>
                <CustomSelect
                  value={removeConfirmation.moveToMappingId}
                  onValueChange={(val) => setRemoveConfirmation({ ...removeConfirmation, moveToMappingId: val })}
                  options={sortedMappings
                    .filter(m => m.template_status_mapping_id !== removeConfirmation.mappingId)
                    .map(m => ({
                      value: m.template_status_mapping_id,
                      label: m.status_name || m.custom_status_name || 'Status',
                    }))}
                />
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('settings.statuses.confirm_delete', { statusName: removeConfirmation.statusName })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button id="cancel-remove-template-status" variant="outline" size="sm" onClick={() => setRemoveConfirmation(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                id="confirm-remove-template-status"
                variant="destructive"
                size="sm"
                onClick={handleRemoveStatus}
                disabled={removeConfirmation.taskCount > 0 && !removeConfirmation.moveToMappingId}
              >
                {removeConfirmation.taskCount > 0
                  ? t('settings.statuses.delete_and_move')
                  : t('templates.statuses.remove_confirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

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
            <div className="space-y-2">
              {sortedMappings.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] rounded-lg border-2 border-dashed">
                  <Circle className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600 dark:text-gray-400">{t('templates.statuses.empty')}</p>
                  <p className="text-sm text-gray-500">{t('templates.statuses.empty_hint')}</p>
                </div>
              ) : (
                sortedMappings.map((mapping, index) => (
                  <div
                    key={mapping.template_status_mapping_id}
                    draggable={editableMappings}
                    onDragStart={() => editableMappings && handleDragStart(index)}
                    onDragOver={(e) => editableMappings && handleDragOver(e, index)}
                    onDragEnd={editableMappings ? handleDragEnd : undefined}
                    className={`flex items-center gap-3 p-3 bg-white dark:bg-[rgb(var(--color-card))] border rounded-lg ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    <div className={`cursor-grab ${!editableMappings ? 'opacity-40' : ''}`}>
                      <GripVertical className="w-4 h-4 text-gray-400" />
                    </div>
                    <Circle
                      className="w-5 h-5"
                      fill={mapping.color || '#6B7280'}
                      stroke={mapping.color || '#6B7280'}
                    />
                    <span className="flex-1 font-medium">
                      {mapping.status_name || mapping.custom_status_name || 'Status'}
                    </span>
                    <span className="text-xs text-gray-500">#{index + 1}</span>
                    <Button
                      id={`remove-status-${mapping.template_status_mapping_id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => initiateRemove(mapping.template_status_mapping_id)}
                      disabled={!editableMappings || sortedMappings.length <= 1}
                    >
                      <Trash className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>

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
                            label: `${s.name}${s.is_closed ? ` (${t('settings.statuses.closed')})` : ''}`,
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
                        {t('common:actions.create')}
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
