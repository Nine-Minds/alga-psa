'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Trash, GripVertical, Circle } from 'lucide-react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IProjectTemplateStatusMapping } from 'server/src/interfaces/projectTemplate.interfaces';
import {
  addTemplateStatusMapping,
  removeTemplateStatusMapping,
  reorderTemplateStatusMappings,
} from 'server/src/lib/actions/project-actions/projectTemplateActions';
import { toast } from 'react-hot-toast';
import { QuickAddStatus } from 'server/src/components/ui/QuickAddStatus';
import { IStatus } from 'server/src/interfaces/status.interface';

interface TemplateStatusManagerProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
  statusMappings: IProjectTemplateStatusMapping[];
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  onStatusAdded: (mapping: IProjectTemplateStatusMapping) => void;
  onStatusRemoved: (mappingId: string) => void;
  onStatusReordered: (orderedMappingIds: string[]) => void;
}

export function TemplateStatusManager({
  open,
  onClose,
  templateId,
  statusMappings,
  availableStatuses,
  onStatusAdded,
  onStatusRemoved,
  onStatusReordered,
}: TemplateStatusManagerProps) {
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);
  const [localAvailableStatuses, setLocalAvailableStatuses] = useState(availableStatuses);

  // Get IDs of statuses already in the template
  const usedStatusIds = new Set(statusMappings.map((m) => m.status_id).filter(Boolean));

  // Filter available statuses to exclude already-used ones
  const unusedStatuses = localAvailableStatuses.filter((s) => !usedStatusIds.has(s.status_id));

  const sortedMappings = [...statusMappings].sort((a, b) => a.display_order - b.display_order);

  const handleAddStatus = async () => {
    if (!selectedStatusId) return;

    setIsAdding(true);
    try {
      const newMapping = await addTemplateStatusMapping(templateId, { status_id: selectedStatusId });
      onStatusAdded(newMapping);
      setSelectedStatusId('');
      toast.success('Status column added');
    } catch (error) {
      toast.error('Failed to add status column');
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveStatus = async (mappingId: string) => {
    if (!confirm('Remove this status column? Tasks in this column will be moved to the first column.')) {
      return;
    }

    try {
      await removeTemplateStatusMapping(mappingId);
      onStatusRemoved(mappingId);
      toast.success('Status column removed');
    } catch (error) {
      toast.error('Failed to remove status column');
      console.error(error);
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
    onStatusReordered(orderedIds);
    setDraggedIndex(targetIndex);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const orderedIds = sortedMappings.map((m) => m.template_status_mapping_id);
      await reorderTemplateStatusMappings(templateId, orderedIds);
    } catch (error) {
      toast.error('Failed to reorder status columns');
      console.error(error);
    } finally {
      setDraggedIndex(null);
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

    // Auto-add to template
    setIsAdding(true);
    try {
      const newMapping = await addTemplateStatusMapping(templateId, { status_id: newStatus.status_id });
      onStatusAdded(newMapping);
      toast.success('Status column added');
    } catch (error) {
      toast.error('Failed to add status column');
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
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
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="cursor-grab">
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
                      onClick={() => handleRemoveStatus(mapping.template_status_mapping_id)}
                      disabled={sortedMappings.length <= 1}
                      title={sortedMappings.length <= 1 ? 'Cannot remove last status column' : 'Remove'}
                    >
                      <Trash className="w-4 h-4 text-red-500" />
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
                      disabled={isAdding}
                      className="flex-1"
                    />
                    <Button
                      id="add-existing-status"
                      onClick={handleAddStatus}
                      disabled={!selectedStatusId || isAdding}
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
        existingStatuses={localAvailableStatuses}
      />
    </>
  );
}
