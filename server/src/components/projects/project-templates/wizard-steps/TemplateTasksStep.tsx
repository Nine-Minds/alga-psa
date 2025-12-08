'use client';

import React, { useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Plus, Trash2, Edit2, Check, X, CheckSquare, ListTodo } from 'lucide-react';
import { TemplateWizardData, TemplateTask, TemplateChecklistItem } from '../TemplateCreationWizard';
import UserPicker from 'server/src/components/ui/UserPicker';
import MultiUserPicker from 'server/src/components/ui/MultiUserPicker';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';

interface TemplateTasksStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
  taskTypes: Array<{ type_key: string; type_name: string; color?: string }>;
  priorities: Array<{ priority_id: string; priority_name: string }>;
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  users: IUserWithRoles[];
  services: IService[];
}

export function TemplateTasksStep({
  data,
  updateData,
  taskTypes,
  priorities,
  availableStatuses,
  users,
  services,
}: TemplateTasksStepProps) {
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(
    data.phases[0]?.temp_id || null
  );
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [saveAttempted, setSaveAttempted] = useState<Set<string>>(new Set());

  // Debug priorities
  React.useEffect(() => {
    console.log('TemplateTasksStep received priorities:', priorities);
  }, [priorities]);

  const selectedPhase = data.phases.find((p) => p.temp_id === selectedPhaseId);
  const phaseTasks = data.tasks.filter((t) => t.phase_temp_id === selectedPhaseId);

  const addTask = () => {
    if (!selectedPhaseId) return;

    // Default to first status mapping if available
    const defaultStatusMappingId = data.status_mappings.length > 0
      ? data.status_mappings[0].temp_id
      : undefined;

    const newTask: TemplateTask = {
      temp_id: `temp_${Date.now()}`,
      phase_temp_id: selectedPhaseId,
      task_name: '',
      description: '',
      estimated_hours: undefined,
      duration_days: undefined,
      task_type_key: 'task',
      priority_id: undefined,
      template_status_mapping_id: defaultStatusMappingId,
      order_number: phaseTasks.length,
    };
    updateData({
      tasks: [...data.tasks, newTask],
    });
    setEditingTaskId(newTask.temp_id);
  };

  const removeTask = (temp_id: string) => {
    const updatedTasks = data.tasks.filter((t) => t.temp_id !== temp_id);
    const updatedChecklists = data.checklist_items.filter((c) => c.task_temp_id !== temp_id);
    updateData({ tasks: updatedTasks, checklist_items: updatedChecklists });
    if (editingTaskId === temp_id) {
      setEditingTaskId(null);
    }
    if (expandedTaskId === temp_id) {
      setExpandedTaskId(null);
    }
  };

  const updateTask = (temp_id: string, updates: Partial<TemplateTask>) => {
    const updated = data.tasks.map((t) => (t.temp_id === temp_id ? { ...t, ...updates } : t));
    updateData({ tasks: updated });
  };

  const addChecklistItem = (task_temp_id: string) => {
    const taskChecklists = data.checklist_items.filter((c) => c.task_temp_id === task_temp_id);
    const newItem: TemplateChecklistItem = {
      temp_id: `temp_${Date.now()}`,
      task_temp_id,
      item_name: '',
      description: '',
      order_number: taskChecklists.length,
    };
    updateData({
      checklist_items: [...data.checklist_items, newItem],
    });
  };

  const removeChecklistItem = (temp_id: string) => {
    const updated = data.checklist_items.filter((c) => c.temp_id !== temp_id);
    updateData({ checklist_items: updated });
  };

  const updateChecklistItem = (temp_id: string, updates: Partial<TemplateChecklistItem>) => {
    const updated = data.checklist_items.map((c) =>
      c.temp_id === temp_id ? { ...c, ...updates } : c
    );
    updateData({ checklist_items: updated });
  };

  if (data.phases.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <ListTodo className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <p className="text-lg text-gray-600 mb-2">No phases available</p>
        <p className="text-sm text-gray-500">
          Please add at least one phase in the previous step before adding tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Tasks</h3>
        <p className="text-sm text-gray-600">
          Add tasks to each phase. You can also add checklist items to break down tasks further.
        </p>
      </div>

      {/* Phase Selector */}
      <div>
        <Label>Select Phase</Label>
        <CustomSelect
          value={selectedPhaseId || ''}
          onValueChange={setSelectedPhaseId}
          options={data.phases.map((p, i) => ({
            value: p.temp_id,
            label: `${i + 1}. ${p.phase_name}`,
          }))}
        />
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {phaseTasks.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <CheckSquare className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-4">
              No tasks in {selectedPhase?.phase_name || 'this phase'}
            </p>
            <Button id="add-first-task" onClick={addTask}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Task
            </Button>
          </div>
        ) : (
          <>
            {phaseTasks
              .sort((a, b) => a.order_number - b.order_number)
              .map((task, index) => {
                const taskChecklists = data.checklist_items.filter(
                  (c) => c.task_temp_id === task.temp_id
                );
                const isExpanded = expandedTaskId === task.temp_id;

                return (
                  <div key={task.temp_id} className="p-4 bg-white border rounded-lg">
                    {editingTaskId === task.temp_id ? (
                      <div className="space-y-3">
                        <div>
                          <Label>Task Name *</Label>
                          <Input
                            value={task.task_name}
                            onChange={(e) =>
                              updateTask(task.temp_id, { task_name: e.target.value })
                            }
                            placeholder="e.g., Design database schema"
                            autoFocus
                          />
                        </div>

                        <div>
                          <Label>Description</Label>
                          <TextArea
                            value={task.description || ''}
                            onChange={(e) =>
                              updateTask(task.temp_id, { description: e.target.value })
                            }
                            placeholder="Describe what needs to be done..."
                            rows={2}
                          />
                        </div>

                        <div>
                          <Label>Service (for time entries)</Label>
                          <CustomSelect
                            value={task.service_id || ''}
                            onValueChange={(value) =>
                              updateTask(task.temp_id, { service_id: value || undefined })
                            }
                            options={[
                              { value: '', label: 'No service' },
                              ...services.map((s) => ({
                                value: s.service_id,
                                label: s.service_name,
                              })),
                            ]}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Auto-fills service when creating time entries from tasks.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Estimated Hours</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.5"
                              value={task.estimated_hours || ''}
                              onChange={(e) =>
                                updateTask(task.temp_id, {
                                  estimated_hours: e.target.value
                                    ? parseFloat(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="Optional"
                            />
                          </div>

                          <div>
                            <Label>Duration (days)</Label>
                            <Input
                              type="number"
                              min="0"
                              value={task.duration_days || ''}
                              onChange={(e) =>
                                updateTask(task.temp_id, {
                                  duration_days: e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="Optional"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Task Type</Label>
                            <CustomSelect
                              value={task.task_type_key || 'task'}
                              onValueChange={(value) =>
                                updateTask(task.temp_id, { task_type_key: value })
                              }
                              options={taskTypes.map((t) => ({
                                value: t.type_key,
                                label: t.type_name,
                              }))}
                            />
                          </div>

                          <div>
                            <Label>Priority</Label>
                            <CustomSelect
                              value={task.priority_id || ''}
                              onValueChange={(value) =>
                                updateTask(task.temp_id, { priority_id: value || undefined })
                              }
                              options={[
                                { value: '', label: 'No priority' },
                                ...priorities.map((p) => ({
                                  value: p.priority_id,
                                  label: p.priority_name,
                                })),
                              ]}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Assigned To</Label>
                            <UserPicker
                              label=""
                              value={task.assigned_to || ''}
                              onValueChange={(value) =>
                                updateTask(task.temp_id, { assigned_to: value || undefined })
                              }
                              users={users}
                              placeholder="Not assigned"
                            />
                          </div>

                          <div>
                            <Label>Additional Agents</Label>
                            {!task.assigned_to ? (
                              <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                                Please assign a primary agent first.
                              </div>
                            ) : (
                              <MultiUserPicker
                                values={task.additional_agents || []}
                                onValuesChange={(values) =>
                                  updateTask(task.temp_id, { additional_agents: values })
                                }
                                users={users.filter(u => u.user_id !== task.assigned_to)}
                              />
                            )}
                          </div>
                        </div>

                        <div>
                          <Label>Status Column</Label>
                          <CustomSelect
                            value={task.template_status_mapping_id || ''}
                            onValueChange={(value) =>
                              updateTask(task.temp_id, {
                                template_status_mapping_id: value || undefined
                              })
                            }
                            options={data.status_mappings.map((s, i) => {
                              const statusName = s.status_id
                                ? availableStatuses.find(st => st.status_id === s.status_id)?.name
                                : s.custom_status_name;
                              return {
                                value: s.temp_id,
                                label: statusName || `Status ${i + 1}`
                              };
                            })}
                            placeholder="Select status column"
                          />
                        </div>

                        <div>
                          {!task.task_name.trim() && saveAttempted.has(task.temp_id) && (
                            <p className="text-sm text-red-600 mb-2">
                              Task name is required
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              id={`save-task-${task.temp_id}`}
                              size="sm"
                              onClick={() => {
                                if (!task.task_name.trim()) {
                                  setSaveAttempted(prev => new Set([...prev, task.temp_id]));
                                } else {
                                  setSaveAttempted(prev => {
                                    const next = new Set(prev);
                                    next.delete(task.temp_id);
                                    return next;
                                  });
                                  setEditingTaskId(null);
                                }
                              }}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Done
                            </Button>
                            <Button
                              id={`cancel-task-${task.temp_id}`}
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSaveAttempted(prev => {
                                  const next = new Set(prev);
                                  next.delete(task.temp_id);
                                  return next;
                                });
                                if (!task.task_name.trim()) {
                                  removeTask(task.temp_id);
                                } else {
                                  setEditingTaskId(null);
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
                      <>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="font-semibold">
                              {index + 1}. {task.task_name}
                            </h4>
                            {task.description && (
                              <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                {task.description}
                              </p>
                            )}
                            <div className="flex gap-4 mt-2 text-xs text-gray-600">
                              {task.estimated_hours && <span>{task.estimated_hours}h</span>}
                              {task.duration_days && <span>{task.duration_days} days</span>}
                              {task.task_type_key && (
                                <span className="capitalize">{task.task_type_key}</span>
                              )}
                              {taskChecklists.length > 0 && (
                                <span>{taskChecklists.length} checklist items</span>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <Button
                              id={`edit-task-${task.temp_id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingTaskId(task.temp_id)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              id={`remove-task-${task.temp_id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTask(task.temp_id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </div>

                        {/* Checklist section */}
                        <div className="mt-3 pt-3 border-t">
                          <Button
                            id={`toggle-checklist-${task.temp_id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedTaskId(isExpanded ? null : task.temp_id)
                            }
                          >
                            <CheckSquare className="w-4 h-4 mr-2" />
                            Checklist ({taskChecklists.length})
                          </Button>

                          {isExpanded && (
                            <div className="mt-2 space-y-2">
                              {taskChecklists.map((item) => (
                                <div
                                  key={item.temp_id}
                                  className="flex items-center gap-2 pl-4"
                                >
                                  <Input
                                    value={item.item_name}
                                    onChange={(e) =>
                                      updateChecklistItem(item.temp_id, {
                                        item_name: e.target.value,
                                      })
                                    }
                                    placeholder="Checklist item..."
                                    className="flex-1"
                                  />
                                  <Button
                                    id={`remove-checklist-${item.temp_id}`}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeChecklistItem(item.temp_id)}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-600" />
                                  </Button>
                                </div>
                              ))}

                              <Button
                                id={`add-checklist-item-${task.temp_id}`}
                                variant="outline"
                                size="sm"
                                onClick={() => addChecklistItem(task.temp_id)}
                                className="ml-4"
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Add Item
                              </Button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

            <Button
              id="add-task"
              variant="outline"
              onClick={addTask}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Task to {selectedPhase?.phase_name}
            </Button>
          </>
        )}
      </div>

      <Alert variant="info">
        <AlertTitle>Tip</AlertTitle>
        <AlertDescription>
          Add checklist items to break down complex tasks into smaller steps. These will help
          team members track progress within each task.
        </AlertDescription>
      </Alert>
    </div>
  );
}
