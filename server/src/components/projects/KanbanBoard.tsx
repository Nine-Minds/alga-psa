'use client';

import { IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import StatusColumn from './StatusColumn';
import styles from './ProjectDetail.module.css';
import { Circle, Clipboard, PlayCircle, PauseCircle, CheckCircle, XCircle } from 'lucide-react';

interface KanbanBoardProps {
  tasks: IProjectTask[];
  phaseTasks: IProjectTask[];
  users: IUserWithRoles[];
  statuses: ProjectStatus[];
  isAddingTask: boolean;
  selectedPhase: boolean;
  ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] };
  taskResources: { [taskId: string]: any[] };
  projectTreeData?: any[]; // Add projectTreeData prop
  onDrop: (e: React.DragEvent, statusId: string, position: 'before' | 'after' | 'end', relativeTaskId: string | null) => void;
  onDragOver: (e: React.DragEvent) => void;
  onAddCard: (status: ProjectStatus) => void;
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onReorderTasks: (updates: { taskId: string, newWbsCode: string }[]) => void;
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
  projectTreeData,
  onDrop,
  onDragOver,
  onAddCard,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
  onReorderTasks,
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
            ticketLinks={ticketLinks}
            taskResources={taskResources}
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
          />
        );
      })}
    </div>
  );
};

export default KanbanBoard;
