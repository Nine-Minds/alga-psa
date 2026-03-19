'use client';

import { useEffect, useMemo, useState } from 'react';
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
  onStatusAdded: (mapping: IProjectTemplateStatusMapping) => void;
  onStatusRemoved: (mappingId: string) => void;
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
  onStatusAdded,
  onStatusRemoved,
  onPhaseStatusesRemoved,
  onStatusReordered,
}: TemplateStatusManagerProps) {
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);
  const [localAvailableStatuses, setLocalAvailableStatuses] = useState(availableStatuses);
  const [removeConfirmation, setRemoveConfirmation] = useState<string | null>(null);
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
    : 'Template Defaults';

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
      toast.success('Status column added');
    } catch (error) {
      handleError(error, 'Failed to add status column');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveStatus = async () => {
    if (!removeConfirmation) return;
    try {
      await removeTemplateStatusMapping(removeConfirmation);
      onStatusRemoved(removeConfirmation);
      toast.success('Status column removed');
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

    // Reorder locally for visual feedback
    const items = [...sortedMappings];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    // Update display order
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

  const handleCopyDefaultsToPhase = async () => {
    if (!selectedTemplatePhaseId) {
      return;
    }

    try {
      const copiedMappings = await copyTemplateStatusesToPhase(templateId, selectedTemplatePhaseId);
      copiedMappings.forEach((mapping) => onStatusAdded(mapping));
      toast.success('Template defaults copied to phase');
    } catch (error) {
      handleError(error, 'Failed to copy template defaults');
    }
  };

  const handleResetPhaseToDefaults = async () => {
    if (!selectedTemplatePhaseId) {
      return;
    }

    try {
      await removeTemplatePhaseStatuses(templateId, selectedTemplatePhaseId);
      onPhaseStatusesRemoved?.(selectedTemplatePhaseId);
      toast.success('Phase reverted to template defaults');
    } catch (error) {
      handleError(error, 'Failed to revert phase statuses');
    } finally {
      setResetToDefaultsConfirmation(false);
    }
  };

  const handleNewStatusCreated = async (newStatus: IStatus) => {
    // Add to local available statuses
    setLocalAvailableStatuses((prev) => [
      ...prev,
      {
        status_id: newStatus.status_id,
        name: newStatus.name,
        color: newStatus.color || undefined,
        is_closed: newStatus.is_closed,
      },
    ]);

    if (!editableMappings) {
      return;
    }

    // Auto-add to template
    setIsAdding(true);
    try {
      const newMapping = await addTemplateStatusMapping(
        templateId,
        { status_id: newStatus.status_id },
        selectedTemplatePhaseId
      );
      onStatusAdded(newMapping);
      toast.success('Status column added');
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
          title="Use Template Defaults"
          message="Remove this phase's custom status columns and fall back to the template defaults?"
          confirmLabel="Use Defaults"
          cancelLabel="Cancel"
        />
      )}

      {removeConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setRemoveConfirmation(null)}
          onConfirm={handleRemoveStatus}
          title="Remove Status Column"
          message="Remove this status column? Tasks in this column will be moved to the first column."
          confirmLabel="Remove"
          cancelLabel="Cancel"
        />
      )}

      <Dialog
        isOpen={open}
        onClose={onClose}
        title="Manage Status Columns"
        className="max-w-lg"
        id="template-status-manager-dialog"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Define the status columns (workflow stages) for tasks in this template. Drag to reorder.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Status Scope</label>
              <CustomSelect
                value={selectedScope}
                onValueChange={setSelectedScope}
                options={[
                  { value: TEMPLATE_DEFAULT_SCOPE, label: 'Template Defaults' },
                  ...phases.map((phase) => ({
                    value: phase.template_phase_id,
                    label: phase.phase_name,
                  })),
                ]}
              />
            </div>

            {selectedTemplatePhaseId && (
              <div className="rounded-lg border bg-gray-50 px-3 py-3 text-sm text-gray-600">
                {isUsingTemplateDefaults ? (
                  <div className="space-y-3">
                    <p>
                      <span className="font-medium text-gray-900">{selectedScopeLabel}</span> is
                      using the template defaults. Copy them into this phase to customize this
                      workflow independently.
                    </p>
                    <Button
                      id="copy-template-default-statuses"
                      size="sm"
                      onClick={handleCopyDefaultsToPhase}
                    >
                      Copy Template Defaults
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p>
                      Editing custom statuses for{' '}
                      <span className="font-medium text-gray-900">{selectedScopeLabel}</span>.
                    </p>
                    <Button
                      id="use-template-default-statuses"
                      variant="outline"
                      size="sm"
                      onClick={() => setResetToDefaultsConfirmation(true)}
                    >
                      Use Template Defaults
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Current Status Columns */}
            <div className="space-y-2">
              {sortedMappings.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed">
                  <Circle className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">No status columns yet</p>
                  <p className="text-sm text-gray-500">Add status columns to organize tasks</p>
                </div>
              ) : (
                sortedMappings.map((mapping, index) => (
                  <div
                    key={mapping.template_status_mapping_id}
                    draggable={editableMappings}
                    onDragStart={() => editableMappings && handleDragStart(index)}
                    onDragOver={(e) => editableMappings && handleDragOver(e, index)}
                    onDragEnd={editableMappings ? handleDragEnd : undefined}
                    className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${
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
                      onClick={() => setRemoveConfirmation(mapping.template_status_mapping_id)}
                      disabled={!editableMappings || sortedMappings.length <= 1}
                      title={
                        !editableMappings
                          ? 'Copy template defaults into this phase before editing'
                          : sortedMappings.length <= 1
                            ? 'Cannot remove last status column'
                            : 'Remove'
                      }
                    >
                      <Trash className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Add Status */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2">Add Status Column</h4>
              <div className="flex gap-2">
                {unusedStatuses.length > 0 ? (
                  <>
                    <CustomSelect
                      value={selectedStatusId}
                      onValueChange={setSelectedStatusId}
                      options={[
                        { value: '', label: 'Select a status...' },
                        ...unusedStatuses.map((s) => ({
                          value: s.status_id,
                          label: `${s.name}${s.is_closed ? ' (Closed)' : ''}`,
                        })),
                      ]}
                      disabled={isAdding || !editableMappings}
                      className="flex-1"
                    />
                    <Button
                      id="add-existing-status"
                      onClick={handleAddStatus}
                      disabled={!selectedStatusId || isAdding || !editableMappings}
                    >
                      {isAdding ? 'Adding...' : 'Add'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 flex-1">All available statuses are in use</p>
                )}
                <Button
                  id="create-new-status"
                  variant="outline"
                  onClick={() => setShowQuickAddStatus(true)}
                  disabled={!editableMappings}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create New
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button id="close-status-manager" onClick={onClose}>
              Done
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
