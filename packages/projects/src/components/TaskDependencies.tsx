'use client';

import React, { useState, useEffect, useImperativeHandle, useMemo, useRef, useCallback } from 'react';
import { IProjectTask, IProjectTaskDependency, ITaskType, DependencyType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { Ban, GitBranch, Link2, Plus, Trash2 } from 'lucide-react';
import { addTaskDependency, removeTaskDependency } from '../actions/projectTaskActions';
import { useDrawer } from "@alga-psa/ui";
import TaskEdit from './TaskEdit';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  pendingMode = false
}, ref) => {
  const { t } = useTranslation('common');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedType, setSelectedType] = useState<DependencyType>('blocked_by');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { openDrawer } = useDrawer();

  const [predecessors, setPredecessors] = useState<IProjectTaskDependency[]>(initialPredecessors);
  const [successors, setSuccessors] = useState<IProjectTaskDependency[]>(initialSuccessors);
  const [pendingDeps, setPendingDeps] = useState<PendingDependency[]>([]);

  // Refs to allow useImperativeHandle callbacks to read latest values
  // without adding them as dependencies (which would cause handle recreation)
  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;
  const selectedTypeRef = useRef(selectedType);
  selectedTypeRef.current = selectedType;
  const pendingModeRef = useRef(pendingMode);
  pendingModeRef.current = pendingMode;
  const pendingDepsRef = useRef(pendingDeps);
  pendingDepsRef.current = pendingDeps;

  // Guard: task is required when not in pendingMode (after hooks to satisfy Rules of Hooks)
  if (!pendingMode && !task) {
    throw new Error(t('projects.dependencies.errors.taskRequired', 'TaskDependencies requires task when pendingMode = false'));
  }

  useEffect(() => {
    setPredecessors(initialPredecessors);
    setSuccessors(initialSuccessors);
  }, [initialPredecessors, initialSuccessors]);

  useEffect(() => {
    // Notify parent when there are unsaved changes
    if (onUnsavedChanges) {
      onUnsavedChanges(!!selectedTaskId);
    }
  }, [selectedTaskId, onUnsavedChanges]);

  const getTaskTypeInfo = (typeKey: string) => {
    return taskTypes.find(t => t.type_key === typeKey);
  };

  const onViewTask = (taskId: string) => {
    const taskData = allTasksInProject.find(t => t.task_id === taskId);
    if (!taskData) {
      return;
    }

    // Find the phase for this task
    let taskPhase = phases?.find(p => p.phase_id === taskData.phase_id);

    // If phase not found or phases array is empty, create a minimal phase object
    if (!taskPhase && phases && phases.length > 0) {
      taskPhase = phases[0];
    }

    // If still no phase or no project_id, we can't open the task editor safely
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
        onClose={() => {}} // Drawer handles its own closing
        onTaskUpdated={(updatedTask: IProjectTask | null) => {
          if (refreshDependencies) {
            refreshDependencies();
          }
        }}
      />
    );
  };

  // Get dependency type display info with icons
  const getDependencyTypeInfo = useCallback((type: DependencyType) => {
    switch (type) {
      case 'blocks':
        return { icon: <Ban className="h-4 w-4 text-red-500" />, label: t('projects.dependencies.types.blocks', 'Blocks') };
      case 'blocked_by':
        return { icon: <Ban className="h-4 w-4 text-orange-500" />, label: t('projects.dependencies.types.blocked_by', 'Blocked by') };
      case 'related_to':
        return { icon: <GitBranch className="h-4 w-4 text-blue-500" />, label: t('projects.dependencies.types.related_to', 'Related to') };
      default:
        return { icon: <Link2 className="h-4 w-4 text-gray-500" />, label: type };
    }
  }, [t]);

  // Function to get the display label and icon from the perspective of the viewing task
  const getDependencyDisplayInfo = useCallback((dependency: IProjectTaskDependency, isPredecessor: boolean) => {
    const { dependency_type } = dependency;

    if (dependency_type === 'related_to') {
      return getDependencyTypeInfo('related_to');
    }

    if (isPredecessor) {
      // This task depends on the predecessor
      if (dependency_type === 'blocks') {
        return getDependencyTypeInfo('blocked_by');
      } else if (dependency_type === 'blocked_by') {
        return getDependencyTypeInfo('blocks');
      }
    } else {
      // This task is the predecessor to the successor
      if (dependency_type === 'blocks') {
        return getDependencyTypeInfo('blocks');
      } else if (dependency_type === 'blocked_by') {
        return getDependencyTypeInfo('blocked_by');
      }
    }

    return getDependencyTypeInfo(dependency_type);
  }, [getDependencyTypeInfo]);

  const addDependency = useCallback(async (targetTaskId: string, dependencyType: DependencyType) => {
    if (!task?.task_id) {
      throw new Error(t('projects.dependencies.errors.taskRequired', 'TaskDependencies requires task when pendingMode = false'));
    }

    setError(null);
    setIsLoading(true);
    try {
      // Always pass current task as predecessor and selected task as successor.
      // addTaskDependency handles the swap for 'blocked_by' internally.
      const predecessorId = task.task_id;
      const successorId = targetTaskId;

      await addTaskDependency(predecessorId, successorId, dependencyType, 0, undefined);
      if (refreshDependencies) refreshDependencies();
    } catch (err: any) {
      setError(err.message || t('projects.dependencies.errors.addFailed', 'Failed to add dependency'));
    } finally {
      setIsLoading(false);
    }
  }, [refreshDependencies, task?.task_id, t]);

  useImperativeHandle(ref, () => ({
    savePendingDependency: async () => {
      const currentTaskId = selectedTaskIdRef.current;
      if (currentTaskId && !pendingModeRef.current) {
        await addDependency(currentTaskId, selectedTypeRef.current);
        setSelectedTaskId('');
        setSelectedType('blocked_by');
        return true;
      }
      return false;
    },
    hasPendingChanges: () => {
      return !!selectedTaskIdRef.current || (pendingModeRef.current && pendingDepsRef.current.length > 0);
    },
    getPendingDependencies: () => pendingDepsRef.current,
  }), [addDependency]);

  const handleAdd = async () => {
    if (!selectedTaskId) return;

    if (pendingMode) {
      // In pending mode (create), store locally instead of calling API
      const targetTask = allTasksInProject.find(t => t.task_id === selectedTaskId);
      if (targetTask) {
        setPendingDeps(prev => [...prev, {
          tempId: crypto?.randomUUID?.() ?? `pending-${Date.now()}`,
          targetTaskId: selectedTaskId,
          targetTaskName: targetTask.task_name,
          targetTaskTypeKey: targetTask.task_type_key || 'task',
          dependencyType: selectedType,
        }]);
      }
      setSelectedTaskId('');
      setSelectedType('blocked_by');
      return;
    }

    await addDependency(selectedTaskId, selectedType);
    setSelectedTaskId('');
    setSelectedType('blocked_by');
  };

  const handleRemove = async (dependencyId: string) => {
    setError(null);
    setIsLoading(true);
    try {
      await removeTaskDependency(dependencyId);
      if (refreshDependencies) refreshDependencies();
    } catch (err: any) {
      setError(err.message || t('projects.dependencies.errors.removeFailed', 'Failed to remove dependency'));
    } finally {
      setIsLoading(false);
    }
  };

  const availableTasks = useMemo(() => allTasksInProject.filter(t => {
    if (task && t.task_id === task.task_id) return false;

    if (pendingMode) {
      // In pending mode, filter out tasks already added with the same dependency type
      return !pendingDeps.find(d =>
        d.targetTaskId === t.task_id && d.dependencyType === selectedType
      );
    }

    // Check based on what dependency will actually be created
    if (selectedType === 'blocks') {
      // Current task blocks selected task: check if this dependency exists
      return !successors.find(d =>
        d.successor_task_id === t.task_id &&
        d.dependency_type === 'blocks'
      );
    } else if (selectedType === 'blocked_by') {
      // Current task blocked by selected task: check if reverse exists
      return !predecessors.find(d =>
        d.predecessor_task_id === t.task_id &&
        d.dependency_type === 'blocks'
      );
    } else {
      // Related to - check both directions
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
    { value: 'blocked_by', label: t('projects.dependencies.types.blocked_by', 'Blocked by') },
    { value: 'blocks', label: t('projects.dependencies.types.blocks', 'Blocks') },
    { value: 'related_to', label: t('projects.dependencies.types.related_to', 'Related to') },
  ]), [t]);

  const availableTaskOptions = useMemo(() => availableTasks.map(t => ({
    value: t.task_id,
    label: t.task_name,
  })), [availableTasks]);

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
        <h3 className="font-semibold">{t('projects.dependencies.title', 'Dependencies')}</h3>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Existing dependencies list (edit mode) */}
      {hasDependencies && (
        <div className="space-y-2">
          {predecessors.map(dep => {
            const displayInfo = getDependencyDisplayInfo(dep, true);
            return (
              <div
                key={dep.dependency_id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskName(dep.predecessor_task)}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(dep.dependency_id)}
                  className="text-red-500 hover:text-red-700 p-1"
                  title={t('projects.dependencies.actions.remove', 'Remove dependency')}
                  disabled={isLoading}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {successors.map(dep => {
            const displayInfo = getDependencyDisplayInfo(dep, false);
            return (
              <div
                key={dep.dependency_id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskName(dep.successor_task)}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(dep.dependency_id)}
                  className="text-red-500 hover:text-red-700 p-1"
                  title={t('projects.dependencies.actions.remove', 'Remove dependency')}
                  disabled={isLoading}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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
            return (
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
                <button
                  id={`remove-pending-dependency-${index}`}
                  type="button"
                  onClick={() => handleRemovePending(dep.tempId)}
                  className="text-red-500 hover:text-red-700 p-1"
                  title={t('projects.dependencies.actions.remove', 'Remove dependency')}
                  aria-label={t('projects.dependencies.actions.removeDependencyAria', 'Remove {{dependencyType}} dependency on {{taskName}}', {
                    dependencyType: dep.dependencyType,
                    taskName: dep.targetTaskName
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new dependency - inline form */}
      {availableTasks.length > 0 && (
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
              value={selectedTaskId}
              onChange={setSelectedTaskId}
              options={availableTaskOptions}
              placeholder={t('projects.dependencies.selectTask', 'Select task...')}
              disabled={isLoading}
              dropdownMode="inline"
            />
          </div>
          <Button
            id="add-dependency"
            type="button"
            variant="soft"
            size="sm"
            onClick={handleAdd}
            disabled={!selectedTaskId || isLoading}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}

      {availableTasks.length === 0 && !hasDependencies && !hasPendingDeps && (
        <p className="text-sm text-gray-500 italic">
          {t('projects.dependencies.noTasks', 'No other tasks available for dependencies')}
        </p>
      )}
    </div>
  );
});

TaskDependencies.displayName = 'TaskDependencies';
