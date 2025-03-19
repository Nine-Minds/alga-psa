'use client';

import { useEffect, useState } from 'react';
import { IProjectTask, IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { CheckSquare, Square, Ticket, Users } from 'lucide-react';
import UserPicker from 'server/src/components/ui/UserPicker';
import { getTaskTicketLinksAction, getTaskResourcesAction } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { ta } from 'date-fns/locale';

interface TaskCardProps {
  task: IProjectTask;
  users: IUserWithRoles[];
  ticketLinks?: IProjectTicketLinkWithDetails[];
  taskResources?: any[];
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string, newTaskName?: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  projectTreeData?: any[]; // Add projectTreeData prop
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  users,
  ticketLinks,
  taskResources: providedTaskResources,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
  projectTreeData,
}) => {
  // Initialize states based on whether data is already available (empty array) or not yet loaded (null)
  const [taskTickets, setTaskTickets] = useState<IProjectTicketLinkWithDetails[] | null>(
    task.ticket_links !== undefined ? task.ticket_links :
    ticketLinks !== undefined ? ticketLinks :
    null
  );
  const [taskResources, setTaskResources] = useState<any[] | null>(
    task.resources !== undefined ? task.resources :
    providedTaskResources !== undefined ? providedTaskResources :
    null
  );
  const [isDragging, setIsDragging] = useState(false);

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
        } else if (task.task_id && taskTickets === null) {
          // Only fetch if data hasn't been loaded yet (null) and we have a task ID
          const links = await getTaskTicketLinksAction(task.task_id);
          setTaskTickets(links || []); // Ensure empty array if API returns null/undefined
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
  }, [task.task_id, task.ticket_links, task.resources, ticketLinks, providedTaskResources]);

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
      className={`bg-white p-3 mb-2 rounded shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 border border-gray-200 flex flex-col gap-1 ${
        isDragging ? 'opacity-50 ring-2 ring-purple-500 shadow-lg scale-105' : ''
      }`}
      aria-grabbed={isDragging}
      aria-label={`Task: ${task.task_name}. Drag to reorder`}
    >
      <div className="font-semibold text-2xl mb-1 w-full px-1">
        {task.task_name}
      </div>
      {task.description && (
        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div>
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
          {hasTickets && (
            <div className={`flex items-center gap-1 ${allTicketsCompleted ? 'bg-green-50 text-green-600' : 'text-gray-500'} px-2 py-1 rounded`}>
              <Ticket className="w-3 h-3" />
              <span>{completedTickets}/{displayTickets.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskCard;
