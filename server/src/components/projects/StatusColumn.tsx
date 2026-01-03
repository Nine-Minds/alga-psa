'use client';

import { IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails, ITaskType, IProjectTaskDependency } from 'server/src/interfaces/project.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
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
  taskTypes: ITaskType[];
  ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] };
  taskResources: { [taskId: string]: any[] };
  taskDependencies?: { [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } };
  taskTags?: Record<string, ITag[]>;
  taskDocumentCounts?: Record<string, number>;
  allTaskTagTexts?: string[];
  statusIcon: React.ReactNode;
  backgroundColor: string;
  darkBackgroundColor: string;
  borderColor: string;
  configuredColor?: string | null; // Hex color from status configuration
  isAddingTask: boolean;
  selectedPhase: boolean;
  projectTreeData?: any[]; // Add projectTreeData prop
  animatingTasks: Set<string>;
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
  onTaskTagsChange?: (taskId: string, tags: ITag[]) => void;
}

export const StatusColumn: React.FC<StatusColumnProps> = ({
  status,
  tasks,
  displayTasks,
  users,
  ticketLinks,
  taskResources,
  taskDependencies = {},
  taskTags = {},
  taskDocumentCounts = {},
  allTaskTagTexts = [],
  statusIcon,
  backgroundColor,
  darkBackgroundColor,
  borderColor,
  configuredColor,
  isAddingTask,
  selectedPhase,
  projectTreeData,
  animatingTasks,
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
  onTaskTagsChange,
  taskTypes,
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

    // Use sortedTasks directly without filtering - we need the actual positions
    // The task being dragged is still in its original position in sortedTasks
    
    // Determine before/after task IDs based on drop position
    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;
    
    const taskElement = findClosestTask(e);
    if (taskElement) {
      const targetTaskId = taskElement.getAttribute('data-task-id');
      
      if (targetTaskId && targetTaskId !== draggedTaskId) {
        // Find the target task in the sorted list (includes all tasks)
        const targetIndex = sortedTasks.findIndex(t => t.task_id === targetTaskId);
        
        if (targetIndex !== -1) {
          const rect = taskElement.getBoundingClientRect();
          const isDropBefore = e.clientY < rect.top + rect.height / 2;
          
          if (isDropBefore) {
            // Dropping before the target task
            // Find the task that will be before our dropped task
            let searchIndex = targetIndex - 1;
            while (searchIndex >= 0) {
              if (sortedTasks[searchIndex].task_id !== draggedTaskId) {
                beforeTaskId = sortedTasks[searchIndex].task_id;
                break;
              }
              searchIndex--;
            }
            
            // The target task will be after our dropped task (unless it's the dragged task itself)
            if (targetTaskId !== draggedTaskId) {
              afterTaskId = targetTaskId;
            } else {
              // If dropping on itself, find the next task
              let nextIndex = targetIndex + 1;
              while (nextIndex < sortedTasks.length) {
                if (sortedTasks[nextIndex].task_id !== draggedTaskId) {
                  afterTaskId = sortedTasks[nextIndex].task_id;
                  break;
                }
                nextIndex++;
              }
            }
          } else {
            // Dropping after the target task
            // The target task will be before our dropped task (unless it's the dragged task itself)
            if (targetTaskId !== draggedTaskId) {
              beforeTaskId = targetTaskId;
            } else {
              // If dropping on itself, find the previous task
              let prevIndex = targetIndex - 1;
              while (prevIndex >= 0) {
                if (sortedTasks[prevIndex].task_id !== draggedTaskId) {
                  beforeTaskId = sortedTasks[prevIndex].task_id;
                  break;
                }
                prevIndex--;
              }
            }
            
            // Find the task that will be after our dropped task
            let searchIndex = targetIndex + 1;
            while (searchIndex < sortedTasks.length) {
              if (sortedTasks[searchIndex].task_id !== draggedTaskId) {
                afterTaskId = sortedTasks[searchIndex].task_id;
                break;
              }
              searchIndex++;
            }
          }
        }
      }
    } else if (sortedTasks.length > 0) {
      // Dropped at the end of the column
      // Find the last task that isn't the dragged task
      for (let i = sortedTasks.length - 1; i >= 0; i--) {
        if (sortedTasks[i].task_id !== draggedTaskId) {
          beforeTaskId = sortedTasks[i].task_id;
          break;
        }
      }
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
      draggedTaskKey: draggedTask?.order_key,
      targetStatusId: status.project_status_mapping_id,
      isDraggedTaskInSameStatus: sortedTasks.some(t => t.task_id === draggedTaskId),
      sortedTasksCount: sortedTasks.length,
      dropTargetElement: taskElement?.getAttribute('data-task-id')
    });
    
    // Validate that we don't have the same key for before and after
    if (beforeTask && afterTask && beforeTask.order_key === afterTask.order_key) {
      console.error('Invalid drop position: before and after keys are the same');
      return;
    }
    
    // Validate order: beforeKey should be less than afterKey when both exist
    if (beforeTask && afterTask && beforeTask.order_key && afterTask.order_key && 
        beforeTask.order_key >= afterTask.order_key) {
      console.error('Invalid drop position: before key is not less than after key');
      return;
    }
    
    // Call parent handler with new parameters
    onDrop(e, status.project_status_mapping_id, draggedTaskId, beforeTaskId, afterTaskId);
  };

  // Sort display tasks by order_key using standard string comparison
  // This ensures fractional-indexing keys are sorted correctly (e.g., 'Zz' < 'a0')
  const sortedTasks = [...displayTasks].sort((a, b) => {
    const keyA = a.order_key || '';
    const keyB = b.order_key || '';
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Helper to lighten hex color (for background)
  const lightenColor = (hex: string, percent: number) => {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
    const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) + (255 - ((num >> 8) & 0x00FF)) * percent));
    const b = Math.min(255, Math.floor((num & 0x0000FF) + (255 - (num & 0x0000FF)) * percent));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  return (
    <div
      className={`${styles.kanbanColumn} ${configuredColor ? '' : backgroundColor} rounded-lg border-2 border-solid transition-all duration-200 ${
        isDraggedOver ? 'border-purple-500 ' + styles.dragOver : (configuredColor ? '' : borderColor)
      }`}
      style={configuredColor ? {
        backgroundColor: lightenColor(configuredColor, 0.85),
        borderColor: isDraggedOver ? undefined : lightenColor(configuredColor, 0.70)
      } : undefined}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="font-bold text-sm p-3 rounded-t-lg flex items-center justify-between relative">
        <div
          className={`flex ${configuredColor ? '' : darkBackgroundColor} rounded-2xl border-2 ${configuredColor ? '' : borderColor} shadow-sm items-center ps-3 py-3 pe-4`}
          style={configuredColor ? {
            backgroundColor: lightenColor(configuredColor, 0.70),
            borderColor: lightenColor(configuredColor, 0.40)
          } : undefined}
        >
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
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={configuredColor ? {
              backgroundColor: lightenColor(configuredColor, 0.70),
              color: configuredColor
            } : undefined}
          >
            {displayTasks.length}
          </span>
        </div>
      </div>
      <div className={`${styles.kanbanTasks} ${styles.taskList}`} ref={tasksRef}>
        {sortedTasks.map((task): React.JSX.Element => {
          const taskType = taskTypes.find(t => t.type_key === task.task_type_key);
          return (
          <div key={task.task_id} data-task-id={task.task_id} className="relative">
            {/* Animated drop placeholder before task */}
            {dragOverTaskId === task.task_id && dropPosition === 'before' && (
              <div className={`${styles.dropPlaceholder} ${styles.visible}`} />
            )}
            <TaskCard
              task={task}
              taskType={taskType}
              users={users}
              ticketLinks={ticketLinks[task.task_id]}
              taskResources={taskResources[task.task_id]}
              taskDependencies={taskDependencies[task.task_id]}
              taskTags={taskTags[task.task_id] || []}
              documentCount={taskDocumentCounts[task.task_id]}
              isAnimating={animatingTasks.has(task.task_id)}
              onTaskSelected={onTaskSelected}
              onAssigneeChange={onAssigneeChange}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              projectTreeData={projectTreeData}
              onMoveTaskClick={onMoveTaskClick}
              onDuplicateTaskClick={onDuplicateTaskClick}
              onEditTaskClick={onEditTaskClick}
              onDeleteTaskClick={onDeleteTaskClick}
              onTaskTagsChange={onTaskTagsChange}
            />
            {/* Animated drop placeholder after task */}
            {dragOverTaskId === task.task_id && dropPosition === 'after' && (
              <div className={`${styles.dropPlaceholder} ${styles.visible}`} />
            )}
          </div>
        )})}
      </div>
    </div>
  );
};

export default StatusColumn;
