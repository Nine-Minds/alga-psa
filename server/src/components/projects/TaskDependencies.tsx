'use client';

import React, { useState, useEffect } from 'react';
import { IProjectTask, IProjectTaskDependency, ITaskType, DependencyType } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { ArrowRight, ArrowRightLeft, GitMerge, GitPullRequest, Lock, Link as LinkIcon, Copy, X, Calendar } from 'lucide-react';
import { addTaskDependency, removeTaskDependency } from 'server/src/lib/actions/project-actions/projectTaskActions';

interface TaskDependenciesProps {
  task: IProjectTask;
  allTasksInProject: IProjectTask[];
  taskTypes: ITaskType[];
  initialPredecessors?: IProjectTaskDependency[];
  initialSuccessors?: IProjectTaskDependency[];
  refreshDependencies?: () => void;
}

const dependencyIcons: Record<DependencyType, React.ReactNode> = {
  finish_to_start: <span title="Finish to Start"><ArrowRight className="w-4 h-4 text-blue-500" /></span>,
  start_to_start: <span title="Start to Start"><ArrowRightLeft className="w-4 h-4 text-green-500" /></span>,
  finish_to_finish: <span title="Finish to Finish"><GitMerge className="w-4 h-4 text-purple-500" /></span>,
  start_to_finish: <span title="Start to Finish"><GitPullRequest className="w-4 h-4 text-orange-500" /></span>,
  blocks: <span title="Blocks"><Lock className="w-4 h-4 text-red-500" /></span>,
  relates_to: <span title="Relates to"><LinkIcon className="w-4 h-4 text-gray-500" /></span>,
  duplicates: <span title="Duplicates"><Copy className="w-4 h-4 text-purple-500" /></span>

};

const dependencyLabels: Record<DependencyType, string> = {
  finish_to_start: 'Finish to Start (FS)',
  start_to_start: 'Start to Start (SS)',
  finish_to_finish: 'Finish to Finish (FF)',
  start_to_finish: 'Start to Finish (SF)',
  blocks: 'Blocks',
  relates_to: 'Related to',
  duplicates: 'Duplicates'
};

export const TaskDependencies: React.FC<TaskDependenciesProps> = ({
  task,
  allTasksInProject,
  taskTypes,
  initialPredecessors = [],
  initialSuccessors = [],
  refreshDependencies
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPredecessorId, setSelectedPredecessorId] = useState('');
  const [selectedType, setSelectedType] = useState<DependencyType>('finish_to_start');
  const [leadLagDays, setLeadLagDays] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [predecessors, setPredecessors] = useState<IProjectTaskDependency[]>(initialPredecessors);
  const [successors, setSuccessors] = useState<IProjectTaskDependency[]>(initialSuccessors);

  useEffect(() => {
    setPredecessors(initialPredecessors);
    setSuccessors(initialSuccessors);
  }, [initialPredecessors, initialSuccessors]);

  const getTaskTypeInfo = (typeKey: string) => {
    return taskTypes.find(t => t.type_key === typeKey);
  };

  const handlePredecessorSelect = (predecessorId: string) => {
    setSelectedPredecessorId(predecessorId);
    
    const predecessor = allTasksInProject.find(t => t.task_id === predecessorId);
    if (predecessor && task) {
      // Auto-suggest dependency type based on task types
      if (predecessor.task_type_key === 'bug') {
        setSelectedType('blocks');
      } else if (predecessor.task_type_key === 'epic' && ['story', 'task'].includes(task.task_type_key)) {
        setSelectedType('finish_to_start');
      } else if (predecessor.task_type_key === 'feature' && task.task_type_key === 'feature') {
        setSelectedType('start_to_start');
      } else {
        setSelectedType('finish_to_start');
      }
    }
  };

  const handleAdd = async () => {
    if (selectedPredecessorId && task.task_id) {
      setError(null);
      setIsLoading(true);
      try {
        await addTaskDependency(selectedPredecessorId, task.task_id, selectedType, leadLagDays, notes || undefined);
        setShowAddForm(false);
        setSelectedPredecessorId('');
        setLeadLagDays(0);
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
  
  const availableTasks = allTasksInProject.filter(t => 
    t.task_id !== task.task_id &&
    !predecessors.find(d => d.predecessor_task_id === t.task_id && d.dependency_type === selectedType)
  );

  const renderTaskWithType = (taskInfo: any) => {
    const typeInfo = getTaskTypeInfo(taskInfo.task_type_key);
    return (
      <span className="flex items-center gap-1">
        {typeInfo && (
          <span 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: typeInfo.color || '#6B7280' }}
            title={typeInfo.type_name}
          />
        )}
        <span className="font-semibold text-xs">{taskInfo.task_name || taskInfo.task_id.substring(0,8)}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="text-red-500 text-xs">{error}</p>}
      
      <div>
        <h4 className="font-medium mb-1">Predecessors (This task depends on):</h4>
        {predecessors.length === 0 ? (
          <p className="text-xs text-gray-500">No dependencies</p>
        ) : (
          <ul className="space-y-1">
            {predecessors.map(dep => (
              <li key={dep.dependency_id} className="flex items-center gap-2 p-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                {dependencyIcons[dep.dependency_type]}
                <span className="text-xs text-gray-600">{dependencyLabels[dep.dependency_type]}</span>
                {renderTaskWithType(dep.predecessor_task)}
                {dep.lead_lag_days !== 0 && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar className="w-3 h-3" />
                    {dep.lead_lag_days > 0 ? `+${dep.lead_lag_days}` : dep.lead_lag_days} days
                  </span>
                )}
                {dep.notes && <span className="text-gray-400 text-xs">({dep.notes})</span>}
                <Button
                  id={`remove-dep-${dep.dependency_id}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(dep.dependency_id)}
                  className="ml-auto p-1 h-auto"
                  disabled={isLoading}
                >
                  <X className="w-3 h-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="font-medium mb-1">Successors (Tasks that depend on this):</h4>
        {successors.length === 0 ? (
          <p className="text-xs text-gray-500">No dependent tasks</p>
        ) : (
          <ul className="space-y-1">
            {successors.map(dep => (
              <li key={dep.dependency_id} className="flex items-center gap-2 p-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                {renderTaskWithType(dep.successor_task)}
                <span className="text-xs text-gray-600">{dependencyLabels[dep.dependency_type]}</span>
                {dependencyIcons[dep.dependency_type]}
                {dep.lead_lag_days !== 0 && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar className="w-3 h-3" />
                    {dep.lead_lag_days > 0 ? `+${dep.lead_lag_days}` : dep.lead_lag_days} days
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddForm ? (
        <div className="border rounded p-3 space-y-3 bg-gray-50 dark:bg-gray-800">
          <p className="text-xs font-medium">Add predecessor for: {task.task_name}</p>
          
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect
              value={selectedPredecessorId}
              onValueChange={handlePredecessorSelect}
              disabled={isLoading}
              placeholder="Select predecessor task"
              options={availableTasks.map(t => ({
                value: t.task_id,
                label: `${t.task_name} (${t.wbs_code || t.task_id.substring(0,8)})`
              }))}
            />
            
            <CustomSelect
              value={selectedType}
              onValueChange={(v: string) => setSelectedType(v as DependencyType)}
              disabled={isLoading}
              options={[
                { value: 'finish_to_start', label: 'Finish to Start (FS)' },
                { value: 'start_to_start', label: 'Start to Start (SS)' },
                { value: 'finish_to_finish', label: 'Finish to Finish (FF)' },
                { value: 'start_to_finish', label: 'Start to Finish (SF)' },
                { value: 'blocks', label: 'Blocks' },
                { value: 'relates_to', label: 'Related To' },
                { value: 'duplicates', label: 'Duplicates' }
              ]}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600">Lead/Lag (days)</label>
              <Input
                type="number"
                value={leadLagDays}
                onChange={(e) => setLeadLagDays(parseInt(e.target.value) || 0)}
                className="text-xs h-8"
                placeholder="0"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Notes (optional)</label>
              <Input
                type="text"
                placeholder="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs h-8"
                disabled={isLoading}
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button 
              id="add-dependency" 
              size="sm" 
              onClick={handleAdd} 
              disabled={!selectedPredecessorId || isLoading} 
              className="text-xs h-8">
              Add Dependency
            </Button>
            <Button
             id="cancel-add-dependency"
             size="sm" 
             variant="ghost" 
             onClick={() => 
             { setShowAddForm(false); setError(null);}} 
             className="text-xs h-8" disabled={isLoading}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button 
          id="show-add-dependency-form" 
          size="sm" 
          variant="outline" 
          onClick={() => setShowAddForm(true)} 
          className="text-xs h-8 mt-2" disabled={isLoading}>
          + Add Dependency
        </Button>
      )}
    </div>
  );
};