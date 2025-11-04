'use client';

import { useEffect, useState } from 'react';
import { IProjectTask, IProjectTicketLinkWithDetails, ITaskType } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IPriority, IStandardPriority } from 'server/src/interfaces/ticket.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { CheckSquare, Square, Ticket, Users, MoreVertical, Move, Copy, Edit, Trash2, Bug, Sparkles, TrendingUp, Flag, BookOpen, Paperclip } from 'lucide-react';
import { findPriorityById } from 'server/src/lib/actions/priorityActions';
import UserPicker from 'server/src/components/ui/UserPicker';
import { getTaskTicketLinksAction, getTaskResourcesAction } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { TagList, TagManager } from 'server/src/components/tags';
import { Button } from 'server/src/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "server/src/components/ui/DropdownMenu";
import styles from 'server/src/components/projects/ProjectDetail.module.css';

interface TaskCardProps {
  task: IProjectTask;
  users: IUserWithRoles[];
  taskType?: ITaskType;
  hasCriticalPath?: boolean;
  ticketLinks?: IProjectTicketLinkWithDetails[];
  taskResources?: any[];
  taskTags?: ITag[];
  documentCount?: number;
  isAnimating?: boolean;
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string, newTaskName?: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  projectTreeData?: any[];
  onMoveTaskClick: (task: IProjectTask) => void;
  onDuplicateTaskClick: (task: IProjectTask) => void;
  onEditTaskClick: (task: IProjectTask) => void;
  onDeleteTaskClick: (task: IProjectTask) => void;
  onTaskTagsChange?: (taskId: string, tags: ITag[]) => void;
}

const taskTypeIcons: Record<string, React.ComponentType<any>> = {
  task: CheckSquare,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  users,
  taskType,
  hasCriticalPath = false,
  ticketLinks,
  taskResources: providedTaskResources,
  taskTags: providedTaskTags = [],
  documentCount: providedDocumentCount,
  isAnimating = false,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
  projectTreeData,
  onMoveTaskClick,
  onDuplicateTaskClick,
  onEditTaskClick,
  onDeleteTaskClick,
  onTaskTagsChange,
}) => {
  // Initialize states based on whether data is already available (empty array) or not yet loaded (null)
  const [taskTickets, setTaskTickets] = useState<IProjectTicketLinkWithDetails[] | null>(
    task.ticket_links !== undefined ? task.ticket_links :
    ticketLinks !== undefined ? ticketLinks :
    [] // Start with empty array instead of null to show counter immediately
  );
  const [taskResources, setTaskResources] = useState<any[] | null>(
    task.resources !== undefined ? task.resources :
    providedTaskResources !== undefined ? providedTaskResources :
    null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [priority, setPriority] = useState<IPriority | IStandardPriority | null>(null);
  const [documentCount, setDocumentCount] = useState<number>(providedDocumentCount ?? 0);
  
  // Update documentCount when providedDocumentCount changes
  useEffect(() => {
    if (providedDocumentCount !== undefined) {
      setDocumentCount(providedDocumentCount);
    }
  }, [providedDocumentCount]);
  const Icon = taskTypeIcons[task.task_type_key || 'task'] || CheckSquare;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Use data in the following priority order:
        // 1. From task object directly
        // 2. From props passed by parent component
        // 3. Fetch from server if neither is available
        
        // Handle ticket links - null means we need to load the data
        if (task.ticket_links !== undefined) {
          setTaskTickets(task.ticket_links);
        } else if (ticketLinks !== undefined) {
          setTaskTickets(ticketLinks);
        } else if (task.task_id && taskTickets !== null && taskTickets.length === 0 && task.ticket_links === undefined && ticketLinks === undefined) {
          // Only fetch if we have an empty array and no data was provided
          try {
            const links = await getTaskTicketLinksAction(task.task_id);
            setTaskTickets(links || []); // Ensure empty array if API returns null/undefined
          } catch (error) {
            console.error('Error fetching ticket links:', error);
            setTaskTickets([]); // Set empty array on error
          }
        }

        // Handle task resources - null means we need to load the data
        if (task.resources !== undefined) {
          setTaskResources(task.resources);
        } else if (providedTaskResources !== undefined) {
          setTaskResources(providedTaskResources);
        } else if (task.task_id && taskResources === null) {
          // Only fetch if data hasn't been loaded yet (null) and we have a task ID
          const resources = await getTaskResourcesAction(task.task_id);
          setTaskResources(resources || []); // Ensure empty array if API returns null/undefined
        }

        // Fetch priority if task has priority_id
        if (task.priority_id && !priority) {
          const taskPriority = await findPriorityById(task.priority_id);
          setPriority(taskPriority);
        }

        // Don't fetch document count - it should be provided from parent
        // Documents should only be fetched when opening the task form

        // Fetch tags only if not provided

      } catch (error) {
        console.error('Error fetching task data:', error);
      }
    };

    fetchData();
  }, [task.task_id, task.ticket_links, task.resources, ticketLinks, providedTaskResources, task.priority_id, priority, providedDocumentCount]);

  // Computed values - ensure we handle the loading state
  const checklistItems = task.checklist_items || [];
  const completedItems = checklistItems.filter(item => item.completed).length;
  const hasChecklist = checklistItems.length > 0;
  const allCompleted = hasChecklist && completedItems === checklistItems.length;

  // Use empty array when tickets are still loading (null)
  const displayTickets = taskTickets || [];
  const completedTickets = displayTickets.filter(link => link.is_closed).length;
  const hasTickets = displayTickets.length > 0;
  const allTicketsCompleted = hasTickets && completedTickets === displayTickets.length;
  
  // Use empty array when resources are still loading (null)
  const displayResources = taskResources || [];

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    onDragStart(e, task.task_id);
    
    // Add scroll zones indicator class to body
    document.body.classList.add('dragging-task');
    
    // Set data for transfer
    e.dataTransfer.setData('text/plain', task.task_id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Set dragged element's height on the drag image
    if (e.target instanceof HTMLElement) {
      const rect = e.target.getBoundingClientRect();
      const dragImage = e.target.cloneNode(true) as HTMLElement;
      dragImage.style.width = `${rect.width}px`;
      dragImage.style.height = `${rect.height}px`;
      dragImage.style.transform = 'translateY(-1000px)';
      dragImage.classList.add('drag-image');
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setIsDragging(false);
    onDragEnd(e);
    
    // Remove scroll zones indicator class from body
    document.body.classList.remove('dragging-task');
    
    // Clear data transfer
    e.dataTransfer.clearData();
  };

  const handleMoveClick = (event: Event) => {
    event.stopPropagation();
    onMoveTaskClick(task);
  };

  const handleDuplicateClick = (event: Event) => {
    event.stopPropagation();
    onDuplicateTaskClick(task);
  };

  const handleEditClick = (event: Event) => {
    event.stopPropagation();
    onEditTaskClick(task);
  };

  const handleDeleteClick = (event: Event) => {
    event.stopPropagation();
    onDeleteTaskClick(task);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => e.preventDefault()} // Allow drop
      onClick={() => {
        onTaskSelected(task);
      }}
      className={`${styles.taskCard} relative bg-white p-3 mb-2 rounded shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 border border-gray-200 flex flex-col gap-1 ${
        isDragging ? styles.dragging : ''
      } ${isAnimating ? styles.entering : ''}`}
      aria-grabbed={isDragging}
      aria-label={`Task: ${task.task_name}. Drag to reorder or use menu for actions.`}
    >
      {/* Task type indicator */}
      <div className="absolute top-2 left-2" title={taskType?.type_name || 'Task'}>
        <Icon 
          className="w-4 h-4" 
          style={{ color: taskType?.color || '#6B7280' }}
        />
      </div>
      

      {/* Action Menu Button */}
      <div className="absolute top-1 right-1 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button id={`task-actions-${task.task_id}`} variant="ghost" size="sm" className="h-6 w-6 p-0">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Task Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={handleMoveClick}>
              <Move className="mr-2 h-4 w-4" />
              <span>Move Task</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDuplicateClick}>
              <Copy className="mr-2 h-4 w-4" />
              <span>Duplicate Task</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleEditClick}>
              <Edit className="mr-2 h-4 w-4" />
              <span>Edit Task</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDeleteClick} className="text-red-600 focus:text-red-700 focus:bg-red-50">
              <Trash2 className="mr-2 h-4 w-4" />
              <span>Delete Task</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 mb-1 w-full px-1 mt-6">
        <div className="font-semibold text-2xl flex-1">
          {task.task_name}
        </div>
        {priority && (
          <div className="flex items-center gap-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: priority.color || '#6B7280' }}
              title={`${priority.priority_name} priority`}
            />
            <span className="text-xs text-gray-600">{priority.priority_name}</span>
          </div>
        )}
      </div>
      {task.description && (
        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div onClick={(e) => e.stopPropagation()}>
          <UserPicker
            value={task.assigned_to || ''}
            onValueChange={(newAssigneeId: string) => onAssigneeChange(task.task_id, newAssigneeId)}
            size="sm"
            users={users.filter(u =>
              !displayResources.some(r => r.additional_user_id === u.user_id)
            )}
          />
        </div>
        {displayResources.length > 0 && (
          <div className="flex items-center gap-1 text-gray-500 bg-primary-100 p-1 rounded-md">
            <Users className="w-3 h-3" />
            <span className="text-xs">+{displayResources.length}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-2">
          {task.due_date ? (
            <>Due date: <span className='bg-primary-100 p-1 rounded-md'>{new Date(task.due_date).toLocaleDateString()}</span></>
          ) : (
            <>No due date</>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasChecklist && (
            <div className={`flex items-center gap-1 ${allCompleted ? 'bg-green-50 text-green-600' : 'text-gray-500'} px-2 py-1 rounded`}>
              {allCompleted ? (
                <CheckSquare className="w-3 h-3" />
              ) : (
                <Square className="w-3 h-3" />
              )}
              <span>{completedItems}/{checklistItems.length}</span>
            </div>
          )}
          {taskTickets !== null && displayTickets.length > 0 && (
            <div className="flex items-center gap-1 text-gray-500 px-2 py-1 rounded bg-gray-50">
              <Ticket className="w-3 h-3" />
              <span>{displayTickets.length}</span>
            </div>
          )}
          {documentCount > 0 && (
            <div className="flex items-center gap-1 text-gray-500 px-2 py-1 rounded bg-gray-50">
              <Paperclip className="w-3 h-3" />
              <span>{documentCount}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Tags at the very bottom */}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        {onTaskTagsChange && task.task_id ? (
          <TagManager
            id={`task-tags-${task.task_id}`}
            entityId={task.task_id}
            entityType="project_task"
            initialTags={providedTaskTags || task.tags || []}
            onTagsChange={(tags) => {
              onTaskTagsChange(task.task_id, tags);
            }}
          />
        ) : (
          (providedTaskTags || task.tags) && (providedTaskTags || task.tags)!.length > 0 && (
            <TagList
              tags={providedTaskTags || task.tags || []}
              maxDisplay={3}
              allowColorEdit={false}
            />
          )
        )}
      </div>
      
      {/* Critical path indicator */}
      {hasCriticalPath && (
        <div className="absolute bottom-1 right-1">
          <span className="text-xs text-orange-600 font-medium bg-orange-50 px-2 py-0.5 rounded">Critical Path</span>
        </div>
      )}
    </div>
  );
};

export default TaskCard;
