'use client';

import { useEffect, useState } from 'react';
import { useTruncationDetection } from '@alga-psa/ui/hooks';
import { IProjectTask, IProjectTicketLinkWithDetails, ITaskType, IProjectTaskDependency } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { IPriority, IStandardPriority } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { CheckSquare, Square, Ticket, MoreVertical, Move, Copy, Edit, Trash2, Bug, Sparkles, TrendingUp, Flag, BookOpen, Paperclip, Ban, GitBranch, Link2 } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { getTaskTicketLinksAction, getTaskResourcesAction } from '../actions/projectTaskActions';
import { TagList } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { Button } from '@alga-psa/ui/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alga-psa/ui/components/DropdownMenu";
import styles from './ProjectDetail.module.css';
import { highlightSearchMatch } from '../lib/searchUtils';

interface TaskCardProps {
  task: IProjectTask;
  users: IUserWithRoles[];
  taskType?: ITaskType;
  hasCriticalPath?: boolean;
  ticketLinks?: IProjectTicketLinkWithDetails[];
  taskResources?: any[];
  taskDependencies?: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] };
  taskTags?: ITag[];
  documentCount?: number;
  priority?: IPriority | IStandardPriority;
  isAnimating?: boolean;
  searchQuery?: string;
  searchCaseSensitive?: boolean;
  searchWholeWord?: boolean;
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
  avatarUrls?: Record<string, string | null>;
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
  taskDependencies,
  taskTags: providedTaskTags = [],
  documentCount: providedDocumentCount,
  priority,
  isAnimating = false,
  searchQuery = '',
  searchCaseSensitive = false,
  searchWholeWord = false,
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
  avatarUrls = {},
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
  const [documentCount, setDocumentCount] = useState<number>(providedDocumentCount ?? 0);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const { ref: descriptionRef, isTruncated: isDescriptionTruncated } = useTruncationDetection<HTMLParagraphElement>();

  // Auto-expand description when search matches in description
  useEffect(() => {
    if (!searchQuery.trim() || !task.description) {
      setIsDescriptionExpanded(false);
      return;
    }

    // Build regex for matching (same logic as filtering)
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = searchWholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
    const regex = new RegExp(pattern, searchCaseSensitive ? '' : 'i');

    // Auto-expand description if the match is in the description
    const matchesDescription = regex.test(task.description);

    if (matchesDescription) {
      setIsDescriptionExpanded(true);
    } else {
      setIsDescriptionExpanded(false);
    }
  }, [searchQuery, searchCaseSensitive, searchWholeWord, task.description]);

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

      } catch (error) {
        console.error('Error fetching task data:', error);
      }
    };

    fetchData();
  }, [task.task_id, task.ticket_links, task.resources, ticketLinks, providedTaskResources, providedDocumentCount]);

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
    console.log("Move task clicked:", task.task_id);
    onMoveTaskClick(task);
  };

  const handleDuplicateClick = (event: Event) => {
    event.stopPropagation();
    console.log("Duplicate task clicked:", task.task_id);
    onDuplicateTaskClick(task);
  };

  const handleEditClick = (event: Event) => {
    event.stopPropagation();
    console.log("Edit task clicked:", task.task_id);
    onEditTaskClick(task);
  };

  const handleDeleteClick = (event: Event) => {
    event.stopPropagation();
    console.log("Delete task clicked:", task.task_id);
    onDeleteTaskClick(task);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => e.preventDefault()} // Allow drop
      onClick={() => {
        // Log that we're using cached project tree data when selecting a task
        console.log('Using cached project tree data when selecting task for editing');
        onTaskSelected(task);
      }}
      className={`${styles.taskCard} relative bg-white p-3 mb-2 rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 border border-gray-200 flex flex-col gap-1 ${
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
        <div className="font-semibold text-lg flex-1">
          {highlightSearchMatch(task.task_name, searchQuery, searchCaseSensitive, searchWholeWord)}
        </div>
        {priority && (
          <div className="flex items-center gap-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: priority.color || '#6B7280' }}
              title={`Priority level: ${priority.priority_name}`}
            />
            <span className="text-xs text-gray-600">{priority.priority_name}</span>
          </div>
        )}
      </div>
      {task.description && (
        <div className="mb-2">
          <p
            ref={descriptionRef}
            className={`text-sm text-gray-600 ${!isDescriptionExpanded ? 'line-clamp-2' : ''}`}
          >
            {highlightSearchMatch(task.description, searchQuery, searchCaseSensitive, searchWholeWord)}
          </p>
          {(isDescriptionTruncated || isDescriptionExpanded) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsDescriptionExpanded(!isDescriptionExpanded);
              }}
              className="text-xs text-purple-600 hover:text-purple-700 font-medium mt-1"
            >
              {isDescriptionExpanded ? 'See less' : 'See more'}
            </button>
          )}
        </div>
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
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          />
        </div>
        {displayResources.length > 0 && (
          <Tooltip
            content={
              <div className="text-xs space-y-1.5">
                <div className="font-medium text-gray-300 mb-1">Additional Agents:</div>
                {displayResources.map((resource, i) => {
                  const resourceUser = users.find(u => u.user_id === resource.additional_user_id);
                  const userName = resourceUser ? `${resourceUser.first_name} ${resourceUser.last_name}` : 'Unknown';
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <UserAvatar
                        userId={resource.additional_user_id}
                        userName={userName}
                        avatarUrl={avatarUrls[resource.additional_user_id] ?? null}
                        size="xs"
                      />
                      <span>
                        {userName}
                        {resource.role && <span className="text-gray-400"> ({resource.role})</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            }
          >
            <span
              className="text-xs font-medium cursor-help px-1.5 py-0.5 rounded"
              style={{
                color: 'rgb(var(--color-primary-500))',
                backgroundColor: 'rgb(var(--color-primary-50))'
              }}
            >
              +{displayResources.length}
            </span>
          </Tooltip>
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
            <Tooltip
              content={
                <div className="text-xs space-y-1 max-w-xs">
                  <div className="font-medium text-gray-300 mb-1">Checklist Items:</div>
                  {checklistItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <CheckSquare className={`h-3 w-3 ${item.completed ? 'text-green-400' : 'text-gray-400'}`} />
                      <span className={item.completed ? 'line-through text-gray-400' : ''}>{item.item_name}</span>
                    </div>
                  ))}
                </div>
              }
            >
              <div className={`flex items-center gap-1 cursor-help ${allCompleted ? 'bg-green-50 text-green-600' : 'text-gray-500'} px-2 py-1 rounded`}>
                {allCompleted ? (
                  <CheckSquare className="w-3 h-3" />
                ) : (
                  <Square className="w-3 h-3" />
                )}
                <span>{completedItems}/{checklistItems.length}</span>
              </div>
            </Tooltip>
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
          {/* Dependencies indicator */}
          {taskDependencies && (taskDependencies.predecessors.length > 0 || taskDependencies.successors.length > 0) && (
            <Tooltip
              content={
                <div className="text-xs space-y-2 min-w-[220px]">
                  {taskDependencies.predecessors.length > 0 && (
                    <div>
                      <div className="font-medium text-gray-300 mb-1">Depends on:</div>
                      {taskDependencies.predecessors.map((d, i) => {
                        const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                        return (
                          <div key={i} className="flex items-center gap-1.5 ml-2">
                            <span className={isBlocking ? 'text-orange-400' : 'text-blue-400'}>
                              {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                            </span>
                            <span>{d.predecessor_task?.task_name || 'Unknown task'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {taskDependencies.successors.length > 0 && (
                    <div>
                      <div className="font-medium text-gray-300 mb-1">Blocks:</div>
                      {taskDependencies.successors.map((d, i) => {
                        const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                        return (
                          <div key={i} className="flex items-center gap-1.5 ml-2">
                            <span className={isBlocking ? 'text-red-400' : 'text-blue-400'}>
                              {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                            </span>
                            <span>{d.successor_task?.task_name || 'Unknown task'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              }
            >
              <div className={`flex items-center gap-1 px-2 py-1 rounded ${
                taskDependencies.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                taskDependencies.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by')
                  ? 'bg-red-50 text-red-500'
                  : 'bg-blue-50 text-blue-500'
              }`}>
                {taskDependencies.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                 taskDependencies.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by')
                  ? <Ban className="w-3 h-3" />
                  : <GitBranch className="w-3 h-3" />
                }
                <span>{taskDependencies.predecessors.length + taskDependencies.successors.length}</span>
              </div>
            </Tooltip>
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
