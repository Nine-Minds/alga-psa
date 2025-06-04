'use client';

import { IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Circle, Plus } from 'lucide-react';
import TaskCard from './TaskCard';
import styles from './ProjectDetail.module.css';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useState, useRef } from 'react';

interface StatusColumnProps {
  status: ProjectStatus;
  tasks: IProjectTask[];
  displayTasks: IProjectTask[];
  users: IUserWithRoles[];
  ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] };
  taskResources: { [taskId: string]: any[] };
  statusIcon: React.ReactNode;
  backgroundColor: string;
  darkBackgroundColor: string;
  borderColor: string;
  isAddingTask: boolean;
  selectedPhase: boolean;
  projectTreeData?: any[]; // Add projectTreeData prop
  onDrop: (e: React.DragEvent, statusId: string, draggedTaskId: string, beforeTaskId: string | null, afterTaskId: string | null) => void;
  onDragOver: (e: React.DragEvent) => void;
  onAddCard: (status: ProjectStatus) => void;
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string, newTaskName?: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onReorderTasks: (updates: { taskId: string, newWbsCode: string }[]) => void;
  onMoveTaskClick: (task: IProjectTask) => void;
  onDuplicateTaskClick: (task: IProjectTask) => void;
  onEditTaskClick: (task: IProjectTask) => void;
  onDeleteTaskClick: (task: IProjectTask) => void;
}

export const StatusColumn: React.FC<StatusColumnProps> = ({
  status,
  tasks,
  displayTasks,
  users,
  ticketLinks,
  taskResources,
  statusIcon,
  backgroundColor,
  darkBackgroundColor,
  borderColor,
  isAddingTask,
  selectedPhase,
  projectTreeData,
  onDrop,
  onDragOver,
  onAddCard,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
  onReorderTasks,
  onMoveTaskClick,
  onDuplicateTaskClick,
  onEditTaskClick,
  onDeleteTaskClick,
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

    const draggedTaskId = e.dataTransfer.getData('text/plain');
    const draggedTask = tasks.find(t => t.task_id === draggedTaskId);
    
    if (!draggedTask) {
      return;
    }

    // Filter out the dragged task from sortedTasks if it's being moved from another status
    const tasksInThisStatus = sortedTasks.filter(t => t.task_id !== draggedTaskId);

    // Determine before/after task IDs based on drop position
    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;
    
    const taskElement = findClosestTask(e);
    if (taskElement) {
      const targetTaskId = taskElement.getAttribute('data-task-id');
      
      if (targetTaskId && targetTaskId !== draggedTaskId) {
        // Find the target task in the already sorted list
        const targetIndex = tasksInThisStatus.findIndex(t => t.task_id === targetTaskId);
        
        if (targetIndex !== -1) {
          const rect = taskElement.getBoundingClientRect();
          const isDropBefore = e.clientY < rect.top + rect.height / 2;
          
          if (isDropBefore) {
            // Insert before target - the target becomes our "after" task
            afterTaskId = targetTaskId;
            if (targetIndex > 0) {
              beforeTaskId = tasksInThisStatus[targetIndex - 1].task_id;
            }
          } else {
            // Insert after target - the target becomes our "before" task
            beforeTaskId = targetTaskId;
            if (targetIndex < tasksInThisStatus.length - 1) {
              afterTaskId = tasksInThisStatus[targetIndex + 1].task_id;
            }
          }
        }
      }
    } else if (tasksInThisStatus.length > 0) {
      // Dropped at the end of the column
      beforeTaskId = tasksInThisStatus[tasksInThisStatus.length - 1].task_id;
    }
    
    // Log the actual order keys for debugging
    const beforeTask = beforeTaskId ? tasks.find(t => t.task_id === beforeTaskId) : null;
    const afterTask = afterTaskId ? tasks.find(t => t.task_id === afterTaskId) : null;
    console.log('Drop position:', { 
      beforeTaskId, 
      beforeKey: beforeTask?.order_key,
      afterTaskId, 
      afterKey: afterTask?.order_key,
      draggedTaskId, 
      targetStatusId: status.project_status_mapping_id 
    });
    
    // Call parent handler with new parameters
    onDrop(e, status.project_status_mapping_id, draggedTaskId, beforeTaskId, afterTaskId);
  };

  // Sort display tasks by order_key
  const sortedTasks = [...displayTasks].sort((a, b) => 
    (a.order_key || '').localeCompare(b.order_key || '')
  );

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
            id="close-agent-picker-button"
            variant="default"
            size="sm"
            onClick={() => onAddCard(status)}
            disabled={isAddingTask || !selectedPhase}
            tooltipText="Add Task"
            tooltip={true}
            className="!w-6 !h-6 !p-0 !min-w-0"
            data-project-tree-data={JSON.stringify(projectTreeData)} // Store project tree data as a data attribute
          >
            <Plus className="w-4 h-4 text-white" />
          </Button>
          <div className={styles.taskCount}>
            {displayTasks.length}
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
              ticketLinks={ticketLinks[task.task_id]}
              taskResources={taskResources[task.task_id]}
              onTaskSelected={onTaskSelected}
              onAssigneeChange={onAssigneeChange}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              projectTreeData={projectTreeData}
              onMoveTaskClick={onMoveTaskClick}
              onDuplicateTaskClick={onDuplicateTaskClick}
              onEditTaskClick={onEditTaskClick}
              onDeleteTaskClick={onDeleteTaskClick}
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
