'use client';

import { useEffect, useState } from 'react';
import { IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails, ITaskType } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { getTaskTypes } from 'server/src/lib/actions/project-actions/projectTaskActions';
import StatusColumn from './StatusColumn';
import styles from './ProjectDetail.module.css';
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
  taskTags?: Record<string, ITag[]>;
  allTaskTagTexts?: string[];
  projectTreeData?: any[]; // Add projectTreeData prop
  animatingTasks: Set<string>;
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

const statusIcons: { [key: string]: React.ReactNode } = {
  'To Do': <Clipboard className="w-4 h-4" />,
  'In Progress': <PlayCircle className="w-4 h-4" />,
  'On Hold': <PauseCircle className="w-4 h-4" />,
  'Done': <CheckCircle className="w-4 h-4" />,
  'Cancelled': <XCircle className="w-4 h-4" />
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
  taskTags = {},
  allTaskTagTexts = [],
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
      {statuses.filter(status => status.is_visible).map((status, index): JSX.Element => {
        const backgroundColor = cycleColors[index % cycleColors.length];
        const darkBackgroundColor = darkCycleColors[index % darkCycleColors.length];
        const borderColor = borderColors[index % borderColors.length];
        const statusTasks = enrichedPhaseTasks.filter((task: IProjectTask) => task.project_status_mapping_id === status.project_status_mapping_id);
        
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
            taskTags={taskTags}
            allTaskTagTexts={allTaskTagTexts}
            statusIcon={statusIcons[status.name] || <Circle className="w-4 h-4" />}
            backgroundColor={backgroundColor}
            darkBackgroundColor={darkBackgroundColor}
            borderColor={borderColor}
            isAddingTask={isAddingTask}
            selectedPhase={selectedPhase}
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
