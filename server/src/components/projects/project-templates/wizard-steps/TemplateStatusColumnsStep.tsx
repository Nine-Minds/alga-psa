'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Trash2, GripVertical, Circle } from 'lucide-react';
import { TemplateWizardData, TemplateStatusMapping } from '../TemplateCreationWizard';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import ColorPicker from 'server/src/components/ui/ColorPicker';

interface TemplateStatusColumnsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  isLoadingStatuses: boolean;
}

export function TemplateStatusColumnsStep({
  data,
  updateData,
  availableStatuses,
  isLoadingStatuses,
}: TemplateStatusColumnsStepProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const addStatusMapping = () => {
    const newMapping: TemplateStatusMapping = {
      temp_id: `temp_${Date.now()}`,
      status_id: '',
      custom_status_name: '',
      custom_status_color: '#6B7280',
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
      return status?.color || '#6B7280';
    }
    return mapping.custom_status_color || '#6B7280';
  };

  const getStatusName = (mapping: TemplateStatusMapping): string => {
    if (mapping.status_id) {
      const status = availableStatuses.find(s => s.status_id === mapping.status_id);
      return status?.name || '';
    }
    return mapping.custom_status_name || '';
  };

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
            <Button id="add-first-status" onClick={addStatusMapping}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Status Column
            </Button>
          </div>
        ) : (
          <>
            {data.status_mappings
              .sort((a, b) => a.display_order - b.display_order)
              .map((mapping, index) => (
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
                    <ColorPicker
                      currentBackgroundColor={getStatusColor(mapping)}
                      currentTextColor={null}
                      onSave={(backgroundColor) =>
                        updateStatusMapping(index, { custom_status_color: backgroundColor || '#6B7280' })
                      }
                      showTextColor={false}
                      previewType="circle"
                      trigger={
                        <button
                          type="button"
                          disabled={!!mapping.status_id}
                          className="disabled:cursor-not-allowed disabled:opacity-50"
                          title={mapping.status_id ? "Color from standard status" : "Click to change color"}
                        >
                          <Circle
                            className="w-6 h-6"
                            fill={getStatusColor(mapping)}
                            stroke={getStatusColor(mapping)}
                          />
                        </button>
                      }
                    />
                    <span className="font-medium">{index + 1}.</span>
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <Label className="text-xs mb-1">Standard Status</Label>
                        <CustomSelect
                          value={mapping.status_id || ''}
                          onValueChange={(value) =>
                            updateStatusMapping(index, { status_id: value, custom_status_name: '' })
                          }
                          options={[
                            { value: '', label: 'Select a status...' },
                            ...availableStatuses.map((s) => ({
                              value: s.status_id,
                              label: s.name,
                            })),
                          ]}
                          disabled={isLoadingStatuses}
                        />
                      </div>

                      <div className="flex items-center justify-center pt-6">
                        <span className="text-gray-400">or</span>
                      </div>

                      <div className="flex-1">
                        <Label className="text-xs mb-1">Custom Status Name</Label>
                        <Input
                          value={mapping.custom_status_name || ''}
                          onChange={(e) =>
                            updateStatusMapping(index, {
                              custom_status_name: e.target.value,
                              status_id: '',
                            })
                          }
                          placeholder="Enter custom name..."
                          disabled={!!mapping.status_id}
                        />
                      </div>
                    </div>
                  </div>

                  <Button
                    id={`remove-status-${index}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStatusMapping(index)}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              ))}

            <Button
              id="add-status-mapping"
              variant="outline"
              onClick={addStatusMapping}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Status Column
            </Button>
          </>
        )}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h4 className="font-medium text-yellow-900 mb-2">Tip</h4>
        <p className="text-sm text-yellow-800">
          You can choose from standard statuses or create custom ones. Drag to reorder the columns
          as they should appear on your board from left to right.
        </p>
      </div>
    </div>
  );
}
