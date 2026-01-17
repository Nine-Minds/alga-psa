'use client';

import React, { useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Plus, Trash2, GripVertical, Circle } from 'lucide-react';
import type { TemplateStatusMapping, TemplateWizardData } from '../../../types/templateWizard';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { QuickAddStatus } from '@alga-psa/ui/components/QuickAddStatus';
import type { IStatus } from '@alga-psa/types';
import { createTenantProjectStatus } from '../../../actions/projectTaskStatusActions';

interface TemplateStatusColumnsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  isLoadingStatuses: boolean;
  onStatusCreated?: (status: IStatus) => void;
}

export function TemplateStatusColumnsStep({
  data,
  updateData,
  availableStatuses,
  isLoadingStatuses,
  onStatusCreated,
}: TemplateStatusColumnsStepProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);

  console.log('[TemplateStatusColumnsStep] availableStatuses:', availableStatuses);
  console.log('[TemplateStatusColumnsStep] availableStatuses.length:', availableStatuses.length);
  console.log('[TemplateStatusColumnsStep] isLoadingStatuses:', isLoadingStatuses);

  // Get IDs of statuses already selected in the template
  const selectedStatusIds = new Set(
    data.status_mappings
      .filter(m => m.status_id)
      .map(m => m.status_id)
  );

  // Filter out already-selected statuses from dropdown options
  const getAvailableOptionsForMapping = (currentMappingStatusId?: string) => {
    return availableStatuses.filter(status => {
      // Always include the currently selected status for this mapping
      if (status.status_id === currentMappingStatusId) return true;
      // Exclude statuses that are already selected in other mappings
      return !selectedStatusIds.has(status.status_id);
    });
  };

  const addStatusMapping = (statusId?: string) => {
    const status = statusId ? availableStatuses.find(s => s.status_id === statusId) : null;

    const newMapping: TemplateStatusMapping = {
      temp_id: `temp_${Date.now()}`,
      status_id: statusId || '',
      custom_status_name: '',
      custom_status_color: status?.color || '#6B7280',
      display_order: data.status_mappings.length,
    };
    updateData({
      status_mappings: [...data.status_mappings, newMapping],
    });
  };

  const removeStatusMapping = (index: number) => {
    const updated = data.status_mappings.filter((_, i) => i !== index);
    // Reorder display_order
    updated.forEach((mapping, i) => {
      mapping.display_order = i;
    });
    updateData({ status_mappings: updated });
  };

  const updateStatusMapping = (index: number, updates: Partial<TemplateStatusMapping>) => {
    const updated = [...data.status_mappings];
    updated[index] = { ...updated[index], ...updates };

    // If selecting a status from dropdown, also update the color
    if (updates.status_id) {
      const status = availableStatuses.find(s => s.status_id === updates.status_id);
      if (status?.color) {
        updated[index].custom_status_color = status.color;
      }
    }

    updateData({ status_mappings: updated });
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const items = [...data.status_mappings];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);

    // Update display_order
    items.forEach((item, i) => {
      item.display_order = i;
    });

    updateData({ status_mappings: items });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const getStatusColor = (mapping: TemplateStatusMapping): string => {
    if (mapping.status_id) {
      const status = availableStatuses.find(s => s.status_id === mapping.status_id);
      return status?.color || mapping.custom_status_color || '#6B7280';
    }
    return mapping.custom_status_color || '#6B7280';
  };

  const handleNewStatusCreated = (newStatus: IStatus) => {
    // Notify parent to refresh the available statuses list
    onStatusCreated?.(newStatus);

    // Add the new status to the template mappings
    addStatusMapping(newStatus.status_id);
  };

  // Check if all available statuses are already selected
  const allStatusesSelected = availableStatuses.length > 0 &&
    availableStatuses.every(s => selectedStatusIds.has(s.status_id));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Status Columns</h3>
        <p className="text-sm text-gray-600">
          Define the status columns that will appear on your project board. These represent
          the workflow stages for tasks (e.g., To Do, In Progress, Done).
        </p>
      </div>

      <div className="space-y-3">
        {data.status_mappings.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Circle className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-4">No status columns added yet</p>
            <div className="flex justify-center gap-2">
              {availableStatuses.length > 0 ? (
                <CustomSelect
                  value=""
                  onValueChange={(value) => {
                    if (value) addStatusMapping(value);
                  }}
                  options={[
                    { value: '', label: 'Select a status to add...' },
                    ...availableStatuses.map((s) => ({
                      value: s.status_id,
                      label: `${s.name}${s.is_closed ? ' (Closed)' : ''}`,
                    })),
                  ]}
                  disabled={isLoadingStatuses}
                  className="w-64"
                />
              ) : (
                <p className="text-sm text-gray-500">No statuses available</p>
              )}
              <Button
                id="add-new-status-empty"
                variant="outline"
                onClick={() => setShowQuickAddStatus(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create New
              </Button>
            </div>
          </div>
        ) : (
          <>
            {data.status_mappings
              .sort((a, b) => a.display_order - b.display_order)
              .map((mapping, index) => {
                const availableOptions = getAvailableOptionsForMapping(mapping.status_id);

                return (
                  <div
                    key={mapping.temp_id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 p-4 bg-white border rounded-lg ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="cursor-move">
                      <GripVertical className="w-5 h-5 text-gray-400" />
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Only show color picker for new statuses (no status_id selected) */}
                      {!mapping.status_id ? (
                        <ColorPicker
                          currentBackgroundColor={getStatusColor(mapping)}
                          currentTextColor={null}
                          onSave={(backgroundColor) =>
                            updateStatusMapping(index, { custom_status_color: backgroundColor || '#6B7280' })
                          }
                          showTextColor={false}
                          previewType="circle"
                          colorMode="solid"
                          trigger={
                            <Button
                              id={`color-picker-trigger-${index}`}
                              variant="ghost"
                              size="sm"
                              className="p-0 hover:opacity-80 transition-opacity"
                              title="Click to change color"
                            >
                              <Circle
                                className="w-6 h-6"
                                fill={getStatusColor(mapping)}
                                stroke={getStatusColor(mapping)}
                              />
                            </Button>
                          }
                        />
                      ) : (
                        /* For existing statuses, just display the color without editing */
                        <Circle
                          className="w-6 h-6"
                          fill={getStatusColor(mapping)}
                          stroke={getStatusColor(mapping)}
                        />
                      )}
                      <span className="font-medium text-gray-500 w-6">{index + 1}.</span>
                    </div>

                    <div className="flex-1">
                      <Label className="text-xs text-gray-500 mb-1 block">Task Status</Label>
                      <CustomSelect
                        value={mapping.status_id || ''}
                        onValueChange={(value) =>
                          updateStatusMapping(index, {
                            status_id: value,
                            custom_status_name: ''
                          })
                        }
                        options={[
                          { value: '', label: 'Select a status...' },
                          ...availableOptions.map((s) => ({
                            value: s.status_id,
                            label: `${s.name}${s.is_closed ? ' (Closed)' : ''}`,
                          })),
                        ]}
                        disabled={isLoadingStatuses}
                      />
                    </div>

                    <Button
                      id={`remove-status-${index}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStatusMapping(index)}
                      title="Remove status column"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                );
              })}

            {/* Add Status Row */}
            <div className="flex gap-2">
              {!allStatusesSelected && availableStatuses.length > 0 && (
                <CustomSelect
                  value=""
                  onValueChange={(value) => {
                    if (value) addStatusMapping(value);
                  }}
                  options={[
                    { value: '', label: 'Add existing status...' },
                    ...availableStatuses
                      .filter(s => !selectedStatusIds.has(s.status_id))
                      .map((s) => ({
                        value: s.status_id,
                        label: `${s.name}${s.is_closed ? ' (Closed)' : ''}`,
                      })),
                  ]}
                  disabled={isLoadingStatuses}
                  className="flex-1"
                />
              )}
              <Button
                id="add-new-status"
                variant="outline"
                onClick={() => setShowQuickAddStatus(true)}
                className={allStatusesSelected ? 'w-full' : ''}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create New Status
              </Button>
            </div>
          </>
        )}
      </div>

      <Alert variant="info">
        <AlertTitle>How it works</AlertTitle>
        <AlertDescription>
          <ul className="space-y-1">
            <li>Select existing statuses from your tenant's status library</li>
            <li>Click "Create New Status" to add a new status to your library</li>
            <li>Drag to reorder columns as they should appear on the board (left to right)</li>
            <li>Each status can only be used once per template</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* Quick Add Status Dialog */}
      <QuickAddStatus
        open={showQuickAddStatus}
        onOpenChange={setShowQuickAddStatus}
        onStatusCreated={handleNewStatusCreated}
        statusType="project_task"
        createStatus={async ({ name, isClosed, color }) =>
          createTenantProjectStatus({ name, is_closed: isClosed, color })
        }
        existingStatuses={availableStatuses}
      />
    </div>
  );
}
