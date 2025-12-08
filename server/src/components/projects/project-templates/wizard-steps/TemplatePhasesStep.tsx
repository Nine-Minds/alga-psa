'use client';

import React, { useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { Plus, Trash2, Edit2, Check, X, GripVertical, Layers, Calculator } from 'lucide-react';
import { TemplateWizardData, TemplatePhase } from '../TemplateCreationWizard';

interface TemplatePhasesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

// Calculate the suggested start offset for a new phase based on previous phases
function calculateNextOffset(phases: TemplatePhase[]): number {
  if (phases.length === 0) return 0;

  // Sort phases by order_number to get the last phase
  const sortedPhases = [...phases].sort((a, b) => a.order_number - b.order_number);
  const lastPhase = sortedPhases[sortedPhases.length - 1];

  // New phase offset = last phase's offset + last phase's duration (if set)
  return lastPhase.start_offset_days + (lastPhase.duration_days || 0);
}

// Recalculate all offsets based on order and durations
function recalculateAllOffsets(phases: TemplatePhase[]): TemplatePhase[] {
  const sortedPhases = [...phases].sort((a, b) => a.order_number - b.order_number);
  let runningOffset = 0;

  return sortedPhases.map((phase, index) => {
    const updatedPhase = {
      ...phase,
      start_offset_days: runningOffset,
      order_number: index, // Ensure order_number is sequential
    };
    // Add this phase's duration to get the next phase's offset
    runningOffset += phase.duration_days || 0;
    return updatedPhase;
  });
}

export function TemplatePhasesStep({
  data,
  updateData,
}: TemplatePhasesStepProps) {
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [saveAttempted, setSaveAttempted] = useState<Set<string>>(new Set());
  const [showRecalculateHint, setShowRecalculateHint] = useState(false);

  const addPhase = () => {
    // Calculate suggested offset based on previous phases
    const suggestedOffset = calculateNextOffset(data.phases);

    const newPhase: TemplatePhase = {
      temp_id: `temp_${Date.now()}`,
      phase_name: '',
      description: '',
      duration_days: undefined,
      start_offset_days: suggestedOffset,
      order_number: data.phases.length,
    };
    updateData({
      phases: [...data.phases, newPhase],
    });
    setEditingPhaseId(newPhase.temp_id);
  };

  const handleRecalculateOffsets = () => {
    const recalculated = recalculateAllOffsets(data.phases);
    updateData({ phases: recalculated });
    setShowRecalculateHint(false);
  };

  const removePhase = (temp_id: string) => {
    const updated = data.phases.filter((p) => p.temp_id !== temp_id);
    // Remove tasks associated with this phase
    const updatedTasks = data.tasks.filter((t) => t.phase_temp_id !== temp_id);
    // Reorder phases
    updated.forEach((phase, i) => {
      phase.order_number = i;
    });
    updateData({ phases: updated, tasks: updatedTasks });
    if (editingPhaseId === temp_id) {
      setEditingPhaseId(null);
    }
  };

  const updatePhase = (temp_id: string, updates: Partial<TemplatePhase>) => {
    const updated = data.phases.map((p) =>
      p.temp_id === temp_id ? { ...p, ...updates } : p
    );
    updateData({ phases: updated });
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const items = [...data.phases];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);

    // Update order_number
    items.forEach((item, i) => {
      item.order_number = i;
    });

    updateData({ phases: items });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    // Show hint to recalculate offsets after reordering
    if (draggedIndex !== null && data.phases.length > 1) {
      setShowRecalculateHint(true);
    }
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Project Phases</h3>
        <p className="text-sm text-gray-600">
          Break down your project into phases. Each phase can have its own tasks and timeline.
        </p>
      </div>

      <div className="space-y-3">
        {data.phases.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Layers className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-4">No phases added yet</p>
            <Button id="add-first-phase" onClick={addPhase}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Phase
            </Button>
          </div>
        ) : (
          <>
            {data.phases
              .sort((a, b) => a.order_number - b.order_number)
              .map((phase, index) => (
                <div
                  key={phase.temp_id}
                  draggable={editingPhaseId !== phase.temp_id}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`p-4 bg-white border rounded-lg ${
                    draggedIndex === index ? 'opacity-50' : ''
                  }`}
                >
                  {editingPhaseId === phase.temp_id ? (
                    <div className="space-y-3">
                      <div>
                        <Label>Phase Name *</Label>
                        <Input
                          value={phase.phase_name}
                          onChange={(e) =>
                            updatePhase(phase.temp_id, { phase_name: e.target.value })
                          }
                          placeholder="e.g., Planning, Development, Testing"
                          autoFocus
                        />
                      </div>

                      <div>
                        <Label>Description</Label>
                        <TextArea
                          value={phase.description || ''}
                          onChange={(e) =>
                            updatePhase(phase.temp_id, { description: e.target.value })
                          }
                          placeholder="Describe what happens in this phase..."
                          rows={2}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Duration (days)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={phase.duration_days || ''}
                            onChange={(e) =>
                              updatePhase(phase.temp_id, {
                                duration_days: e.target.value ? parseInt(e.target.value) : undefined,
                              })
                            }
                            placeholder="Optional"
                          />
                        </div>

                        <div>
                          <Label>Start Offset (days)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={phase.start_offset_days}
                            onChange={(e) =>
                              updatePhase(phase.temp_id, {
                                start_offset_days: parseInt(e.target.value) || 0,
                              })
                            }
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Days after project start
                          </p>
                        </div>
                      </div>

                      <div>
                        {!phase.phase_name.trim() && saveAttempted.has(phase.temp_id) && (
                          <p className="text-sm text-red-600 mb-2">
                            Phase name is required
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            id={`save-phase-${phase.temp_id}`}
                            size="sm"
                            onClick={() => {
                              if (!phase.phase_name.trim()) {
                                setSaveAttempted(prev => new Set([...prev, phase.temp_id]));
                              } else {
                                setSaveAttempted(prev => {
                                  const next = new Set(prev);
                                  next.delete(phase.temp_id);
                                  return next;
                                });
                                setEditingPhaseId(null);
                              }
                            }}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            Done
                          </Button>
                          <Button
                            id={`cancel-phase-${phase.temp_id}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSaveAttempted(prev => {
                                const next = new Set(prev);
                                next.delete(phase.temp_id);
                                return next;
                              });
                              if (!phase.phase_name.trim()) {
                                removePhase(phase.temp_id);
                              } else {
                                setEditingPhaseId(null);
                              }
                            }}
                          >
                            <X className="w-4 h-4 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="cursor-move pt-1">
                        <GripVertical className="w-5 h-5 text-gray-400" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-semibold text-lg">
                              {index + 1}. {phase.phase_name}
                            </h4>
                            {phase.description && (
                              <p className="text-sm text-gray-600 mt-1">{phase.description}</p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              id={`edit-phase-${phase.temp_id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingPhaseId(phase.temp_id)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              id={`remove-phase-${phase.temp_id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => removePhase(phase.temp_id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </div>

                        <div className="flex gap-4 text-sm text-gray-600">
                          {phase.duration_days && (
                            <span>Duration: {phase.duration_days} days</span>
                          )}
                          {phase.start_offset_days > 0 && (
                            <span>Starts: +{phase.start_offset_days} days</span>
                          )}
                          <span>
                            Tasks:{' '}
                            {data.tasks.filter((t) => t.phase_temp_id === phase.temp_id).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

            <Button
              id="add-phase"
              variant="outline"
              onClick={addPhase}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Phase
            </Button>
          </>
        )}
      </div>

      {/* Recalculate offsets hint - shown after reordering */}
      {showRecalculateHint && data.phases.length > 1 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">
            Phases reordered. Would you like to recalculate offsets based on phase order and durations?
          </p>
          <div className="flex gap-2">
            <Button
              id="recalculate-offsets"
              size="sm"
              variant="outline"
              onClick={handleRecalculateOffsets}
            >
              <Calculator className="w-4 h-4 mr-1" />
              Recalculate
            </Button>
            <Button
              id="dismiss-recalculate"
              size="sm"
              variant="ghost"
              onClick={() => setShowRecalculateHint(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Always show recalculate button when there are multiple phases */}
      {!showRecalculateHint && data.phases.length > 1 && (
        <div className="flex justify-end">
          <Button
            id="recalculate-offsets-manual"
            size="sm"
            variant="ghost"
            onClick={handleRecalculateOffsets}
            className="text-gray-600"
          >
            <Calculator className="w-4 h-4 mr-1" />
            Recalculate Offsets
          </Button>
        </div>
      )}

      <Alert variant="info">
        <AlertTitle>About Phase Timing</AlertTitle>
        <AlertDescription>
          <strong>Start Offset:</strong> Days after the project start date when this phase begins.
          New phases auto-calculate their offset based on preceding phases.
          <br />
          <strong>Duration:</strong> How long this phase typically takes. Used to calculate the next
          phase's offset.
          <br />
          <strong>Tip:</strong> After reordering phases, use "Recalculate Offsets" to update timing
          based on the new order.
        </AlertDescription>
      </Alert>
    </div>
  );
}
