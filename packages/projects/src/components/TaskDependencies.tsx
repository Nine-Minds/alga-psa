'use client';

import React, { useState, useEffect, useImperativeHandle, useMemo, useRef, useCallback } from 'react';
import { IProjectTask, IProjectTaskDependency, ITaskType, DependencyType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { Ban, GitBranch, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { addTaskDependency, removeTaskDependency } from '../actions/projectTaskActions';
import { useDrawer } from "@alga-psa/ui";
import TaskEdit from './TaskEdit';

// Stable empty arrays to prevent useEffect dependency churn from default parameters
const EMPTY_PREDECESSORS: IProjectTaskDependency[] = [];
const EMPTY_SUCCESSORS: IProjectTaskDependency[] = [];

interface TaskDependenciesProps {
  task?: IProjectTask;
  allTasksInProject: IProjectTask[];
  taskTypes: ITaskType[];
  initialPredecessors?: IProjectTaskDependency[];
  initialSuccessors?: IProjectTaskDependency[];
  refreshDependencies?: () => void;
  users?: any[];
  phases?: any[];
  onUnsavedChanges?: (hasUnsaved: boolean) => void;
  pendingMode?: boolean;
  currentPhaseId?: string;
}

export interface PendingDependency {
  tempId: string;
  targetTaskId: string;
  targetTaskName: string;
  targetTaskTypeKey: string;
  dependencyType: DependencyType;
}

export interface TaskDependenciesRef {
  savePendingDependency: () => Promise<boolean>;
  hasPendingChanges: () => boolean;
  getPendingDependencies: () => PendingDependency[];
}

export const TaskDependencies = React.forwardRef<TaskDependenciesRef, TaskDependenciesProps>(({
  task,
  allTasksInProject,
  taskTypes,
  initialPredecessors = EMPTY_PREDECESSORS,
  initialSuccessors = EMPTY_SUCCESSORS,
  refreshDependencies,
  users = [],
  phases = [],
  onUnsavedChanges,
  pendingMode = false,
  currentPhaseId,
}, ref) => {
  const [selectedType, setSelectedType] = useState<DependencyType>('blocked_by');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<DependencyType>('blocked_by');
  const [isAdding, setIsAdding] = useState(false);
  const { openDrawer } = useDrawer();

  const [predecessors, setPredecessors] = useState<IProjectTaskDependency[]>(initialPredecessors);
  const [successors, setSuccessors] = useState<IProjectTaskDependency[]>(initialSuccessors);
  const [pendingDeps, setPendingDeps] = useState<PendingDependency[]>([]);

  // Refs to allow useImperativeHandle callbacks to read latest values
  // without adding them as dependencies (which would cause handle recreation)
  const pendingDepsRef = useRef(pendingDeps);
  pendingDepsRef.current = pendingDeps;

  // Guard: task is required when not in pendingMode
  if (!pendingMode && !task) {
    throw new Error('TaskDependencies requires task when pendingMode = false');
  }

  useEffect(() => {
    setPredecessors(initialPredecessors);
    setSuccessors(initialSuccessors);
  }, [initialPredecessors, initialSuccessors]);

  const getTaskTypeInfo = (typeKey: string) => {
    return taskTypes.find(t => t.type_key === typeKey);
  };

  const onViewTask = (taskId: string) => {
    const taskData = allTasksInProject.find(t => t.task_id === taskId);
    if (!taskData) {
      return;
    }

    let taskPhase = phases?.find(p => p.phase_id === taskData.phase_id);

    if (!taskPhase && phases && phases.length > 0) {
      taskPhase = phases[0];
    }

    if (!taskPhase || !taskPhase.project_id) {
      console.error('Cannot open task: missing phase or project information');
      return;
    }

    openDrawer(
      <TaskEdit
        task={taskData}
        phase={taskPhase}
        phases={phases}
        users={users}
        inDrawer={true}
        onClose={() => {}}
        onTaskUpdated={(_updatedTask: IProjectTask | null) => {
          if (refreshDependencies) {
            refreshDependencies();
          }
        }}
      />
    );
  };

  const getDependencyTypeInfo = useCallback((type: DependencyType) => {
    switch (type) {
      case 'blocks':
        return { icon: <Ban className="h-4 w-4 text-destructive" />, label: 'Blocks' };
      case 'blocked_by':
        return { icon: <Ban className="h-4 w-4 text-orange-500" />, label: 'Blocked by' };
      case 'related_to':
        return { icon: <GitBranch className="h-4 w-4 text-blue-500" />, label: 'Related to' };
      default:
        return { icon: <Link2 className="h-4 w-4 text-gray-500" />, label: type };
    }
  }, []);

  const getDependencyDisplayInfo = useCallback((dependency: IProjectTaskDependency, isPredecessor: boolean) => {
    const { dependency_type } = dependency;

    if (dependency_type === 'related_to') {
      return getDependencyTypeInfo('related_to');
    }

    if (isPredecessor) {
      if (dependency_type === 'blocks') {
        return getDependencyTypeInfo('blocked_by');
      } else if (dependency_type === 'blocked_by') {
        return getDependencyTypeInfo('blocks');
      }
    } else {
      if (dependency_type === 'blocks') {
        return getDependencyTypeInfo('blocks');
      } else if (dependency_type === 'blocked_by') {
        return getDependencyTypeInfo('blocked_by');
      }
    }

    return getDependencyTypeInfo(dependency_type);
  }, [getDependencyTypeInfo]);

  const handleAdd = async (taskId: string) => {
    if (!taskId) return;

    if (pendingMode) {
      const targetTask = allTasksInProject.find(t => t.task_id === taskId);
      if (targetTask) {
        setPendingDeps(prev => [...prev, {
          tempId: crypto?.randomUUID?.() ?? `pending-${Date.now()}`,
          targetTaskId: taskId,
          targetTaskName: targetTask.task_name,
          targetTaskTypeKey: targetTask.task_type_key || 'task',
          dependencyType: selectedType,
        }]);
      }
      setSelectedType('blocked_by');
      setIsAdding(false);
      return;
    }

    if (!task?.task_id) return;

    setError(null);
    setIsLoading(true);
    try {
      await addTaskDependency(task.task_id, taskId, selectedType, 0, undefined);
      setSelectedType('blocked_by');
      setIsAdding(false);
      if (refreshDependencies) refreshDependencies();
    } catch (err: any) {
      setError(err.message || 'Failed to add dependency');
    } finally {
      setIsLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({
    savePendingDependency: async () => false,
    hasPendingChanges: () => false,
    getPendingDependencies: () => pendingDepsRef.current,
  }), []);

  const handleRemove = async (dependencyId: string) => {
    setError(null);
    setIsLoading(true);
    try {
      await removeTaskDependency(dependencyId);
      if (refreshDependencies) refreshDependencies();
    } catch (err: any) {
      setError(err.message || 'Failed to remove dependency');
    } finally {
      setIsLoading(false);
    }
  };

  // Get the user-facing dependency type (predecessors flip blocks↔blocked_by)
  const getEffectiveType = (dep: IProjectTaskDependency, isPredecessor: boolean): DependencyType => {
    if (dep.dependency_type === 'related_to') return 'related_to';
    if (isPredecessor) {
      return dep.dependency_type === 'blocks' ? 'blocked_by' : 'blocks';
    }
    return dep.dependency_type;
  };

  const handleEditDependency = async (oldDependencyId: string, newTaskId: string) => {
    if (!task?.task_id || !newTaskId) return;
    setError(null);
    setIsLoading(true);
    try {
      await removeTaskDependency(oldDependencyId);
      await addTaskDependency(task.task_id, newTaskId, editingType, 0, undefined);
      setEditingId(null);
      if (refreshDependencies) refreshDependencies();
    } catch (err: any) {
      setError(err.message || 'Failed to update dependency');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditing = (id: string, currentType: DependencyType) => {
    setEditingId(id);
    setEditingType(currentType);
  };

  const availableTasks = useMemo(() => allTasksInProject.filter(t => {
    if (task && t.task_id === task.task_id) return false;

    if (pendingMode) {
      return !pendingDeps.find(d =>
        d.targetTaskId === t.task_id && d.dependencyType === selectedType
      );
    }

    if (selectedType === 'blocks') {
      return !successors.find(d =>
        d.successor_task_id === t.task_id &&
        d.dependency_type === 'blocks'
      );
    } else if (selectedType === 'blocked_by') {
      return !predecessors.find(d =>
        d.predecessor_task_id === t.task_id &&
        d.dependency_type === 'blocks'
      );
    } else {
      return !predecessors.find(d =>
        d.predecessor_task_id === t.task_id &&
        d.dependency_type === 'related_to'
      ) && !successors.find(d =>
        d.successor_task_id === t.task_id &&
        d.dependency_type === 'related_to'
      );
    }
  }), [allTasksInProject, task?.task_id, pendingMode, pendingDeps, selectedType, predecessors, successors]);

  const renderTaskName = (taskInfo: any) => {
    const typeInfo = getTaskTypeInfo(taskInfo.task_type_key);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onViewTask(taskInfo.task_id);
        }}
        className="flex items-center gap-2"
      >
        {typeInfo && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: typeInfo.color || '#6B7280' }}
            title={typeInfo.type_name}
          />
        )}
        <span className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
          {taskInfo.task_name || taskInfo.task_id.substring(0, 8)}
        </span>
      </button>
    );
  };

  const hasDependencies = predecessors.length > 0 || successors.length > 0;
  const hasPendingDeps = pendingDeps.length > 0;

  const dependencyTypeOptions = useMemo(() => ([
    { value: 'blocked_by', label: 'Blocked by' },
    { value: 'blocks', label: 'Blocks' },
    { value: 'related_to', label: 'Related to' },
  ]), []);

  const resolvedPhaseId = currentPhaseId || task?.phase_id;

  const availableTaskOptions = useMemo(() => {
    const sorted = [...availableTasks].sort((a, b) => {
      if (!resolvedPhaseId) return 0;
      const aInPhase = a.phase_id === resolvedPhaseId;
      const bInPhase = b.phase_id === resolvedPhaseId;
      if (aInPhase && !bInPhase) return -1;
      if (!aInPhase && bInPhase) return 1;
      return 0;
    });

    return sorted.map(t => {
      const taskPhase = phases?.find((p: any) => p.phase_id === t.phase_id);
      const isCurrentPhase = resolvedPhaseId && t.phase_id === resolvedPhaseId;
      const label = taskPhase && !isCurrentPhase
        ? `${t.task_name}  ·  ${taskPhase.phase_name}`
        : t.task_name;
      return { value: t.task_id, label };
    });
  }, [availableTasks, resolvedPhaseId, phases]);

  const getEditTaskOptions = useCallback((excludeTaskId: string) => {
    // All project tasks except the current task, formatted with phase labels
    const tasks = allTasksInProject.filter(t => {
      if (task && t.task_id === task.task_id) return false;
      if (t.task_id === excludeTaskId) return false;
      return true;
    });

    const sorted = [...tasks].sort((a, b) => {
      if (!resolvedPhaseId) return 0;
      const aInPhase = a.phase_id === resolvedPhaseId;
      const bInPhase = b.phase_id === resolvedPhaseId;
      if (aInPhase && !bInPhase) return -1;
      if (!aInPhase && bInPhase) return 1;
      return 0;
    });

    return sorted.map(t => {
      const taskPhase = phases?.find((p: any) => p.phase_id === t.phase_id);
      const isCurrentPhase = resolvedPhaseId && t.phase_id === resolvedPhaseId;
      const label = taskPhase && !isCurrentPhase
        ? `${t.task_name}  ·  ${taskPhase.phase_name}`
        : t.task_name;
      return { value: t.task_id, label };
    });
  }, [allTasksInProject, task?.task_id, resolvedPhaseId, phases]);

  const handleTypeChange = useCallback((v: string) => {
    setSelectedType(v as DependencyType);
  }, []);

  const handleRemovePending = useCallback((tempId: string) => {
    setPendingDeps(prev => prev.filter(d => d.tempId !== tempId));
  }, []);

  return (
    <div className="border-t pt-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="h-5 w-5 text-gray-500" />
        <h3 className="font-semibold">Dependencies</h3>
        <Button
          id="add-dependency-header"
          type="button"
          variant="soft"
          size="sm"
          onClick={() => setIsAdding(!isAdding)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Existing dependencies list (edit mode) */}
      {hasDependencies && (
        <div className="space-y-2">
          {predecessors.map(dep => {
            const displayInfo = getDependencyDisplayInfo(dep, true);
            const isEditing = editingId === dep.dependency_id;
            const effectiveType = getEffectiveType(dep, true);
            return isEditing ? (
              <div key={dep.dependency_id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <CustomSelect
                  value={editingType}
                  onValueChange={(v) => setEditingType(v as DependencyType)}
                  options={dependencyTypeOptions}
                  className="w-32"
                  disabled={isLoading}
                />
                <div className="flex-1">
                  <SearchableSelect
                    id={`edit-dep-${dep.dependency_id}`}
                    value=""
                    onChange={(newTaskId) => {
                      if (newTaskId) {
                        handleEditDependency(dep.dependency_id, newTaskId);
                      }
                    }}
                    options={getEditTaskOptions(dep.predecessor_task_id)}
                    placeholder="Select new task..."
                    disabled={isLoading}
                    dropdownMode="inline"
                  />
                </div>
                <Button
                  id={`cancel-edit-dep-${dep.dependency_id}`}
                  variant="icon"
                  size="icon"
                  onClick={() => setEditingId(null)}
                  title="Cancel edit"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                key={dep.dependency_id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskName(dep.predecessor_task)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    id={`edit-dep-${dep.dependency_id}`}
                    variant="icon"
                    size="icon"
                    onClick={() => startEditing(dep.dependency_id, effectiveType)}
                    title="Edit dependency"
                    disabled={isLoading}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    id={`remove-dep-${dep.dependency_id}`}
                    variant="icon"
                    size="icon"
                    onClick={() => handleRemove(dep.dependency_id)}
                    className="text-destructive hover:text-destructive"
                    title="Remove dependency"
                    disabled={isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          {successors.map(dep => {
            const displayInfo = getDependencyDisplayInfo(dep, false);
            const isEditing = editingId === dep.dependency_id;
            const effectiveType = getEffectiveType(dep, false);
            return isEditing ? (
              <div key={dep.dependency_id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <CustomSelect
                  value={editingType}
                  onValueChange={(v) => setEditingType(v as DependencyType)}
                  options={dependencyTypeOptions}
                  className="w-32"
                  disabled={isLoading}
                />
                <div className="flex-1">
                  <SearchableSelect
                    id={`edit-dep-${dep.dependency_id}`}
                    value=""
                    onChange={(newTaskId) => {
                      if (newTaskId) {
                        handleEditDependency(dep.dependency_id, newTaskId);
                      }
                    }}
                    options={getEditTaskOptions(dep.successor_task_id)}
                    placeholder="Select new task..."
                    disabled={isLoading}
                    dropdownMode="inline"
                  />
                </div>
                <Button
                  id={`cancel-edit-dep-${dep.dependency_id}`}
                  variant="icon"
                  size="icon"
                  onClick={() => setEditingId(null)}
                  title="Cancel edit"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                key={dep.dependency_id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskName(dep.successor_task)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    id={`edit-dep-${dep.dependency_id}`}
                    variant="icon"
                    size="icon"
                    onClick={() => startEditing(dep.dependency_id, effectiveType)}
                    title="Edit dependency"
                    disabled={isLoading}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    id={`remove-dep-${dep.dependency_id}`}
                    variant="icon"
                    size="icon"
                    onClick={() => handleRemove(dep.dependency_id)}
                    className="text-destructive hover:text-destructive"
                    title="Remove dependency"
                    disabled={isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending dependencies list (create mode) */}
      {pendingMode && hasPendingDeps && (
        <div className="space-y-2">
          {pendingDeps.map((dep, index) => {
            const typeInfo = getDependencyTypeInfo(dep.dependencyType);
            const taskTypeInfo = getTaskTypeInfo(dep.targetTaskTypeKey);
            const isEditing = editingId === dep.tempId;
            return isEditing ? (
              <div key={dep.tempId} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <CustomSelect
                  value={editingType}
                  onValueChange={(v) => setEditingType(v as DependencyType)}
                  options={dependencyTypeOptions}
                  className="w-32"
                />
                <div className="flex-1">
                  <SearchableSelect
                    id={`edit-pending-dep-${dep.tempId}`}
                    value=""
                    onChange={(newTaskId) => {
                      if (newTaskId) {
                        const newTask = allTasksInProject.find(t => t.task_id === newTaskId);
                        if (newTask) {
                          setPendingDeps(prev => prev.map(d =>
                            d.tempId === dep.tempId
                              ? { ...d, targetTaskId: newTaskId, targetTaskName: newTask.task_name, targetTaskTypeKey: newTask.task_type_key || 'task', dependencyType: editingType }
                              : d
                          ));
                        }
                        setEditingId(null);
                      }
                    }}
                    options={getEditTaskOptions(dep.targetTaskId)}
                    placeholder="Select new task..."
                    dropdownMode="inline"
                  />
                </div>
                <Button
                  id={`cancel-edit-pending-dep-${dep.tempId}`}
                  variant="icon"
                  size="icon"
                  onClick={() => setEditingId(null)}
                  title="Cancel edit"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                key={dep.tempId}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  {typeInfo.icon}
                  <span className="text-sm text-gray-600">{typeInfo.label}</span>
                  <div className="flex items-center gap-2">
                    {taskTypeInfo && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: taskTypeInfo.color || '#6B7280' }}
                        title={taskTypeInfo.type_name}
                      />
                    )}
                    <span className="text-sm font-medium">{dep.targetTaskName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    id={`edit-pending-dep-${index}`}
                    variant="icon"
                    size="icon"
                    onClick={() => startEditing(dep.tempId, dep.dependencyType)}
                    title="Edit dependency"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    id={`remove-pending-dependency-${index}`}
                    variant="icon"
                    size="icon"
                    onClick={() => handleRemovePending(dep.tempId)}
                    className="text-destructive hover:text-destructive"
                    title="Remove dependency"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new dependency - inline form */}
      {isAdding && availableTasks.length > 0 && (
        <div className="flex items-center gap-2">
          <CustomSelect
            value={selectedType}
            onValueChange={handleTypeChange}
            options={dependencyTypeOptions}
            className="w-32"
            disabled={isLoading}
          />
          <div className="flex-1">
            <SearchableSelect
              id="dependency-target-task-select"
              value=""
              onChange={(taskId) => {
                if (taskId) {
                  handleAdd(taskId);
                }
              }}
              options={availableTaskOptions}
              placeholder="Select task..."
              disabled={isLoading}
              dropdownMode="inline"
            />
          </div>
        </div>
      )}

      {availableTasks.length === 0 && !hasDependencies && !hasPendingDeps && (
        <p className="text-sm text-gray-500 italic">
          No other tasks available for dependencies
        </p>
      )}
    </div>
  );
});

TaskDependencies.displayName = 'TaskDependencies';
