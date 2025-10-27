'use client';

import React, { useState, useEffect, useImperativeHandle } from 'react';
import { IProjectTask, IProjectTaskDependency, ITaskType, DependencyType } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { Lock, Link as LinkIcon, X } from 'lucide-react';
import { addTaskDependency, removeTaskDependency } from '@product/actions/project-actions/projectTaskActions';
import { useDrawer } from "server/src/context/DrawerContext";
import TaskEdit from './TaskEdit';

interface TaskDependenciesProps {
  task: IProjectTask;
  allTasksInProject: IProjectTask[];
  taskTypes: ITaskType[];
  initialPredecessors?: IProjectTaskDependency[];
  initialSuccessors?: IProjectTaskDependency[];
  refreshDependencies?: () => void;
  users?: any[];
  phases?: any[];
  onUnsavedChanges?: (hasUnsaved: boolean) => void;
}

const dependencyIcons: Record<DependencyType, React.ReactNode> = {
  blocks: <span title="Blocks"><Lock className="w-4 h-4 text-red-500" /></span>,
  blocked_by: <span title="Blocked by"><Lock className="w-4 h-4 text-orange-500" /></span>,
  related_to: <span title="Related to"><LinkIcon className="w-4 h-4 text-gray-500" /></span>
};

const dependencyLabels: Record<DependencyType, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related_to: 'Related to'
};

// Function to get the display label and icon from the perspective of the viewing task
const getDependencyDisplayInfo = (dependency: IProjectTaskDependency, isPredecessor: boolean) => {
  const { dependency_type } = dependency;
  
  if (dependency_type === 'related_to') {
    return {
      label: 'Related to',
      icon: dependencyIcons.related_to
    };
  }
  
  if (isPredecessor) {
    // This task depends on the predecessor
    if (dependency_type === 'blocks') {
      return { label: 'Blocked by', icon: dependencyIcons.blocked_by };
    } else if (dependency_type === 'blocked_by') {
      return { label: 'Blocks', icon: dependencyIcons.blocks };
    }
  } else {
    // This task is the predecessor to the successor
    if (dependency_type === 'blocks') {
      return { label: 'Blocks', icon: dependencyIcons.blocks };
    } else if (dependency_type === 'blocked_by') {
      return { label: 'Blocked by', icon: dependencyIcons.blocked_by };
    }
  }
  
  return {
    label: dependencyLabels[dependency_type],
    icon: dependencyIcons[dependency_type]
  };
};

export interface TaskDependenciesRef {
  savePendingDependency: () => Promise<boolean>;
  hasPendingChanges: () => boolean;
}

export const TaskDependencies = React.forwardRef<TaskDependenciesRef, TaskDependenciesProps>(({
  task,
  allTasksInProject,
  taskTypes,
  initialPredecessors = [],
  initialSuccessors = [],
  refreshDependencies,
  users = [],
  phases = [],
  onUnsavedChanges
}, ref) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPredecessorId, setSelectedPredecessorId] = useState('');
  const [selectedType, setSelectedType] = useState<DependencyType>('related_to');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { openDrawer } = useDrawer();
  
  const [predecessors, setPredecessors] = useState<IProjectTaskDependency[]>(initialPredecessors);
  const [successors, setSuccessors] = useState<IProjectTaskDependency[]>(initialSuccessors);

  useImperativeHandle(ref, () => ({
    savePendingDependency: async () => {
      if (showAddForm && selectedPredecessorId) {
        await handleAdd();
        return true;
      }
      return false;
    },
    hasPendingChanges: () => {
      return showAddForm && !!selectedPredecessorId;
    }
  }));

  useEffect(() => {
    setPredecessors(initialPredecessors);
    setSuccessors(initialSuccessors);
  }, [initialPredecessors, initialSuccessors]);

  useEffect(() => {
    // Notify parent when there are unsaved changes (form is open with data)
    if (onUnsavedChanges) {
      onUnsavedChanges(showAddForm && !!selectedPredecessorId);
    }
  }, [showAddForm, selectedPredecessorId, onUnsavedChanges]);

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

  const handlePredecessorSelect = (predecessorId: string) => {
    setSelectedPredecessorId(predecessorId);
  };

  const handleAdd = async () => {
    if (selectedPredecessorId && task.task_id) {
      setError(null);
      setIsLoading(true);
      try {
        // Determine the correct order based on the relationship type
        let predecessorId: string;
        let successorId: string;
        
        if (selectedType === 'blocks') {
          // Current task blocks the selected task
          predecessorId = task.task_id;
          successorId = selectedPredecessorId;
        } else if (selectedType === 'blocked_by') {
          // Current task is blocked by the selected task
          predecessorId = selectedPredecessorId;
          successorId = task.task_id;
        } else {
          // For 'related_to', order doesn't matter but we'll keep it consistent
          predecessorId = task.task_id;
          successorId = selectedPredecessorId;
        }
        
        await addTaskDependency(predecessorId, successorId, selectedType, 0, notes || undefined);
        setShowAddForm(false);
        setSelectedPredecessorId('');
        setNotes('');
        if (refreshDependencies) refreshDependencies();
      } catch (err: any) {
        setError(err.message || 'Failed to add dependency');
      } finally {
        setIsLoading(false);
      }
    }
  };

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
  
  const availableTasks = allTasksInProject.filter(t => {
    if (t.task_id === task.task_id) return false;
    
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
  });

  const renderTaskWithType = (taskInfo: any) => {
    const typeInfo = getTaskTypeInfo(taskInfo.task_type_key);
    return (
      <span className="flex items-center gap-2">
        {typeInfo && (
          <span 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: typeInfo.color || '#6B7280' }}
            title={typeInfo.type_name}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onViewTask(taskInfo.task_id);
          }}
          className="font-semibold text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
        >
          {taskInfo.task_name || taskInfo.task_id.substring(0,8)}
        </button>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-red-500 text-sm">{error}</p>}
      
      {(predecessors.length > 0 || successors.length > 0) && (
        <div>
          <h4 className="font-medium mb-2">Related Tasks:</h4>
          <ul className="space-y-2">
            {predecessors.map(dep => {
              const displayInfo = getDependencyDisplayInfo(dep, true);
              return (
                <li key={dep.dependency_id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskWithType(dep.predecessor_task)}
                  {dep.notes && <span className="text-gray-400 text-sm">({dep.notes})</span>}
                <Button
                  id={`remove-dep-${dep.dependency_id}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(dep.dependency_id)}
                  className="ml-auto"
                  disabled={isLoading}
                >
                  <X className="w-4 h-4" />
                </Button>
              </li>
              );
            })}
            {successors.map(dep => {
              const displayInfo = getDependencyDisplayInfo(dep, false);
              return (
                <li key={dep.dependency_id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
                  {displayInfo.icon}
                  <span className="text-sm text-gray-600">{displayInfo.label}</span>
                  {renderTaskWithType(dep.successor_task)}
                  {dep.notes && <span className="text-gray-400 text-sm">({dep.notes})</span>}
                <Button
                  id={`remove-dep-${dep.dependency_id}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(dep.dependency_id)}
                  className="ml-auto"
                  disabled={isLoading}
                >
                  <X className="w-4 h-4" />
                </Button>
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {showAddForm ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Add dependency for: {task.task_name}</p>
          
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect
              value={selectedType}
              onValueChange={(v: string) => setSelectedType(v as DependencyType)}
              disabled={isLoading}
              options={[
                { value: 'blocks', label: 'Blocks' },
                { value: 'blocked_by', label: 'Blocked by' },
                { value: 'related_to', label: 'Related to' }
              ]}
            />
            
            <CustomSelect
              value={selectedPredecessorId}
              onValueChange={handlePredecessorSelect}
              disabled={isLoading}
              placeholder="Select task"
              options={availableTasks.map(t => ({
                value: t.task_id,
                label: t.task_name
              }))}
            />
          </div>
          
          <div>
            <label className="text-sm text-gray-600">Notes (optional)</label>
            <Input
              type="text"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm"
              disabled={isLoading}
            />
          </div>
          
          <div className="flex gap-2 justify-end">
            <Button
             id="cancel-add-dependency"
             size="sm" 
             variant="ghost" 
             onClick={() => 
             { setShowAddForm(false); setError(null);}} 
             disabled={isLoading}>
              Cancel
            </Button>
            <Button 
              id="add-dependency" 
              size="sm" 
              onClick={handleAdd} 
              disabled={!selectedPredecessorId || isLoading}>
              Add Dependency
            </Button>
          </div>
        </div>
      ) : (
        <Button 
          id="show-add-dependency-form" 
          size="sm" 
          variant="outline" 
          onClick={() => setShowAddForm(true)} 
          className="mt-2" disabled={isLoading}>
          + Add Dependency
        </Button>
      )}
    </div>
  );
});

TaskDependencies.displayName = 'TaskDependencies';