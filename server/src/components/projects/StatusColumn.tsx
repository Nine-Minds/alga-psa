'use client';

import { IProjectTask, ProjectStatus } from '@/interfaces/project.interfaces';
import { Button } from '@/components/ui/Button';
import { Circle, Plus } from 'lucide-react';
import TaskCard from './TaskCard';
import styles from './ProjectDetail.module.css';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { useState, useRef } from 'react';

interface StatusColumnProps {
  status: ProjectStatus;
  tasks: IProjectTask[];
  users: IUserWithRoles[];
  statusIcon: React.ReactNode;
  backgroundColor: string;
  darkBackgroundColor: string;
  borderColor: string;
  isAddingTask: boolean;
  selectedPhase: boolean;
  onDrop: (e: React.DragEvent, statusId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onAddCard: (status: ProjectStatus) => void;
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string, newTaskName?: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onReorderTasks: (updates: { taskId: string, newWbsCode: string }[]) => void;
}

export const StatusColumn: React.FC<StatusColumnProps> = ({
  status,
  tasks,
  users,
  statusIcon,
  backgroundColor,
  darkBackgroundColor,
  borderColor,
  isAddingTask,
  selectedPhase,
  onDrop,
  onDragOver,
  onAddCard,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
  onReorderTasks,
}) => {
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const tasksRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDraggedOver) {
      setIsDraggedOver(true);
    }

    // Find the task being dragged over
    const taskElement = findClosestTask(e);
    if (taskElement) {
      const taskId = taskElement.getAttribute('data-task-id');
      const rect = taskElement.getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      
      setDragOverTaskId(taskId);
      setDropPosition(position);
    } else {
      setDragOverTaskId(null);
      setDropPosition(null);
    }

    onDragOver(e);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOver(false);
    setDragOverTaskId(null);
    setDropPosition(null);
  };

  const findClosestTask = (e: React.DragEvent): HTMLElement | null => {
    if (!tasksRef.current) return null;

    const taskElements = Array.from(tasksRef.current.children) as HTMLElement[];
    let closestTask: HTMLElement | null = null;
    let closestDistance = Infinity;

    taskElements.forEach(taskElement => {
      const rect = taskElement.getBoundingClientRect();
      const taskMiddle = rect.top + rect.height / 2;
      const distance = Math.abs(e.clientY - taskMiddle);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestTask = taskElement;
      }
    });

    return closestTask;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOver(false);
    setDragOverTaskId(null);
    setDropPosition(null);

    const draggedTaskId = e.dataTransfer.getData('text');
    const draggedTask = tasks.find(t => t.task_id === draggedTaskId);
    
    if (!draggedTask) return;

    // If the task is from a different status, handle status change
    if (draggedTask.project_status_mapping_id !== status.project_status_mapping_id) {
      onDrop(e, status.project_status_mapping_id);
      return;
    }

    // Handle reordering within the same status
    const taskElement = findClosestTask(e);
    if (!taskElement) return;

    const targetTaskId = taskElement.getAttribute('data-task-id');
    if (!targetTaskId || targetTaskId === draggedTaskId) return;

    const targetTask = tasks.find(t => t.task_id === targetTaskId);
    if (!targetTask) return;

    // Calculate new WBS codes for reordering
    const orderedTasks = [...tasks].sort((a, b) =>
      a.wbs_code.localeCompare(b.wbs_code)
    );

    const draggedIndex = orderedTasks.findIndex(t => t.task_id === draggedTaskId);
    const targetIndex = orderedTasks.findIndex(t => t.task_id === targetTaskId);
    
    // Remove dragged task
    orderedTasks.splice(draggedIndex, 1);
    
    // Insert at new position
    const insertIndex = e.clientY < taskElement.getBoundingClientRect().top + taskElement.getBoundingClientRect().height / 2
      ? targetIndex
      : targetIndex + 1;
    
    orderedTasks.splice(insertIndex, 0, draggedTask);

    // Update WBS codes
    const updates = orderedTasks.map((task, index) => ({
      taskId: task.task_id,
      newWbsCode: task.wbs_code.split('.').slice(0, -1).concat(String(index + 1)).join('.')
    }));

    // Call parent handler to update WBS codes
    onReorderTasks(updates);
  };

  // Sort tasks by WBS code
  const sortedTasks = [...tasks].sort((a, b) => a.wbs_code.localeCompare(b.wbs_code));

  return (
    <div
      className={`${styles.kanbanColumn} ${backgroundColor} rounded-lg border-2 border-solid transition-all duration-200 ${
        isDraggedOver ? 'border-purple-500' : 'border-gray-200'
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="font-bold text-sm p-3 rounded-t-lg flex items-center justify-between relative z-10">
        <div className={`flex ${darkBackgroundColor} rounded-[20px] border-2 ${borderColor} shadow-sm items-center ps-3 py-3 pe-4`}>
          {statusIcon}
          <span className="ml-2">{status.custom_name || status.name}</span>
        </div>
        <div className={styles.statusHeader}>
          <Button
            variant="default"
            size="sm"
            onClick={() => onAddCard(status)}
            disabled={isAddingTask || !selectedPhase}
            tooltipText="Add Task"
            tooltip={true}
            className="!w-6 !h-6 !p-0 !min-w-0"
          >
            <Plus className="w-4 h-4 text-white" />
          </Button>
          <div className={styles.taskCount}>
            {tasks.length}
          </div>
        </div>
      </div>
      <div className={styles.kanbanTasks} ref={tasksRef}>
        {sortedTasks.map((task): JSX.Element => (
          <div key={task.task_id} data-task-id={task.task_id} className="relative">
            {dragOverTaskId === task.task_id && dropPosition === 'before' && (
              <div className="absolute -top-1 left-0 right-0 h-0.5 bg-purple-500 rounded-full" />
            )}
            <TaskCard
              task={task}
              users={users}
              onTaskSelected={onTaskSelected}
              onAssigneeChange={onAssigneeChange}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
            {dragOverTaskId === task.task_id && dropPosition === 'after' && (
              <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-purple-500 rounded-full" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatusColumn;
