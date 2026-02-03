'use client';

import { useEffect, useState } from 'react';
import { IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails, ITaskType, IProjectTaskDependency } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { IPriority, IStandardPriority } from '@alga-psa/types';
import { getTaskTypes } from '../actions/projectTaskActions';
import StatusColumn from './StatusColumn';
import styles from './ProjectDetail.module.css';
import * as LucideIcons from 'lucide-react';
import { Circle, Clipboard, PlayCircle, PauseCircle, CheckCircle, XCircle } from 'lucide-react';

interface KanbanBoardProps {
  tasks: IProjectTask[];
  phaseTasks: IProjectTask[];
  taskTypes: ITaskType[];
  users: IUserWithRoles[];
  statuses: ProjectStatus[];
  isAddingTask: boolean;
  selectedPhase: boolean;
  ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] };
  taskResources: { [taskId: string]: any[] };
  taskDependencies?: { [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } };
  taskTags?: Record<string, ITag[]>;
  taskDocumentCounts?: Map<string, number>;
  allTaskTags?: ITag[];
  priorities?: (IPriority | IStandardPriority)[];
  projectTreeData?: any[]; // Add projectTreeData prop
  animatingTasks: Set<string>;
  avatarUrls?: Record<string, string | null>;
  searchQuery?: string;
  searchCaseSensitive?: boolean;
  searchWholeWord?: boolean;
  onDrop: (e: React.DragEvent, statusId: string, draggedTaskId: string, beforeTaskId: string | null, afterTaskId: string | null) => void;
  onDragOver: (e: React.DragEvent) => void;
  onAddCard: (status: ProjectStatus) => void;
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onReorderTasks: (updates: { taskId: string, newWbsCode: string }[]) => void;
  onMoveTaskClick: (task: IProjectTask) => void;
  onDuplicateTaskClick: (task: IProjectTask) => void;
  onEditTaskClick: (task: IProjectTask) => void;
  onDeleteTaskClick: (task: IProjectTask) => void;
  onTaskTagsChange?: (taskId: string, tags: ITag[]) => void;
}

// Helper function to get the configured icon or fallback to auto-detected icon
const getStatusIcon = (status: ProjectStatus): React.ReactNode => {
  // If status has a configured icon, use it
  if (status.icon) {
    const IconComponent = (LucideIcons as any)[status.icon];
    if (IconComponent) {
      return <IconComponent className="w-4 h-4" />;
    }
  }

  // Fallback to auto-detection based on status name and is_closed flag
  if (status.is_closed) {
    return <CheckCircle className="w-4 h-4" />;
  }

  const displayName = status.custom_name || status.name;
  const lowerName = displayName.toLowerCase();

  if (lowerName.includes('progress') || lowerName.includes('doing')) {
    return <PlayCircle className="w-4 h-4" />;
  }
  if (lowerName.includes('hold') || lowerName.includes('blocked') || lowerName.includes('waiting')) {
    return <PauseCircle className="w-4 h-4" />;
  }
  if (lowerName.includes('cancel')) {
    return <XCircle className="w-4 h-4" />;
  }
  if (lowerName.includes('done') || lowerName.includes('complete')) {
    return <CheckCircle className="w-4 h-4" />;
  }

  // Default icon for new/todo/open statuses
  return <Clipboard className="w-4 h-4" />;
};

const borderColors = ['border-gray-300', 'border-indigo-300', 'border-green-300', 'border-yellow-300'];
const cycleColors = ['bg-gray-100', 'bg-indigo-100', 'bg-green-100', 'bg-yellow-100'];
const darkCycleColors = ['bg-gray-200', 'bg-indigo-200', 'bg-green-200', 'bg-yellow-200'];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  phaseTasks,
  users,
  statuses,
  isAddingTask,
  selectedPhase,
  ticketLinks,
  taskResources,
  taskDependencies = {},
  taskTags = {},
  taskDocumentCounts = {},
  allTaskTags = [],
  priorities = [],
  projectTreeData,
  animatingTasks,
  avatarUrls = {},
  searchQuery = '',
  searchCaseSensitive = false,
  searchWholeWord = false,
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
  // Ensure all tasks have ticket_links and resources initialized
  const enrichedTasks = tasks.map(task => {
    // Only create a new object if we need to add properties
    if (task.ticket_links === undefined || task.resources === undefined) {
      return {
        ...task,
        // Initialize ticket_links if undefined (preserve if already set)
        ticket_links: task.ticket_links !== undefined ?
          task.ticket_links :
          (ticketLinks[task.task_id] || []),
        // Initialize resources if undefined (preserve if already set)
        resources: task.resources !== undefined ?
          task.resources :
          (taskResources[task.task_id] || [])
      };
    }
    return task;
  });

  // Do the same for phase tasks
  const enrichedPhaseTasks = phaseTasks.map(task => {
    if (task.ticket_links === undefined || task.resources === undefined) {
      return {
        ...task,
        ticket_links: task.ticket_links !== undefined ?
          task.ticket_links :
          (ticketLinks[task.task_id] || []),
        resources: task.resources !== undefined ?
          task.resources :
          (taskResources[task.task_id] || [])
      };
    }
    return task;
  });
  
  return (
    <div className={styles.kanbanBoard}>
      {statuses.filter(status => status.is_visible).map((status, index): React.JSX.Element => {
        // Use configured color or fallback to cycling colors
        const configuredColor = status.color;
        const backgroundColor = configuredColor ? '' : cycleColors[index % cycleColors.length];
        const darkBackgroundColor = configuredColor ? '' : darkCycleColors[index % darkCycleColors.length];
        const borderColor = configuredColor ? '' : borderColors[index % borderColors.length];

        const statusTasks = enrichedPhaseTasks.filter((task: IProjectTask) => task.project_status_mapping_id === status.project_status_mapping_id);

        const statusIcon = getStatusIcon(status);

        return (
          <StatusColumn
            key={status.project_status_mapping_id}
            status={status}
            tasks={enrichedTasks}
            displayTasks={statusTasks}
            users={users}
            taskTypes={taskTypes}
            ticketLinks={ticketLinks}
            taskResources={taskResources}
            taskDependencies={taskDependencies}
            taskTags={taskTags}
            taskDocumentCounts={taskDocumentCounts instanceof Map ? Object.fromEntries(taskDocumentCounts.entries()) : {}}
            priorities={priorities}
            statusIcon={statusIcon}
            backgroundColor={backgroundColor}
            darkBackgroundColor={darkBackgroundColor}
            borderColor={borderColor}
            configuredColor={configuredColor}
            isAddingTask={isAddingTask}
            selectedPhase={selectedPhase}
            avatarUrls={avatarUrls}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onAddCard={onAddCard}
            onTaskSelected={onTaskSelected}
            onAssigneeChange={onAssigneeChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onReorderTasks={onReorderTasks}
            projectTreeData={projectTreeData}
            animatingTasks={animatingTasks}
            searchQuery={searchQuery}
            searchCaseSensitive={searchCaseSensitive}
            searchWholeWord={searchWholeWord}
            onMoveTaskClick={onMoveTaskClick}
            onDuplicateTaskClick={onDuplicateTaskClick}
            onEditTaskClick={onEditTaskClick}
            onDeleteTaskClick={onDeleteTaskClick}
            onTaskTagsChange={onTaskTagsChange}
          />
        );
      })}
    </div>
  );
};

export default KanbanBoard;
