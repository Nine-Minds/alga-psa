'use client';

import { IProjectTask } from '@/interfaces/project.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { CheckSquare, Square } from 'lucide-react';
import UserPicker from '@/components/ui/UserPicker';

interface TaskCardProps {
  task: IProjectTask;
  users: IUserWithRoles[];
  onTaskSelected: (task: IProjectTask) => void;
  onAssigneeChange: (taskId: string, newAssigneeId: string) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  users,
  onTaskSelected,
  onAssigneeChange,
  onDragStart,
  onDragEnd,
}) => {
  const checklistItems = task.checklist_items || [];
  const completedItems = checklistItems.filter(item => item.completed).length;
  const hasChecklist = checklistItems.length > 0;
  const allCompleted = hasChecklist && completedItems === checklistItems.length;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.task_id)}
      onDragEnd={onDragEnd}
      onClick={() => onTaskSelected(task)}
      className="bg-white p-3 mb-2 rounded shadow-sm cursor-pointer hover:shadow-md transition-shadow duration-200 border border-gray-200 flex flex-col gap-1"
    >
      <p className="font-semibold text-base mb-1">{task.task_name}</p>
      {task.description && (
        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
          {task.description}
        </p>
      )}
      <div onClick={(e) => e.stopPropagation()}>
        <UserPicker
          value={task.assigned_to || ''}
          onValueChange={(newAssigneeId: string) => onAssigneeChange(task.task_id, newAssigneeId)}
          size="sm"
          users={users}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-2">
          {task.due_date ? (
            <>Due date: <span className='bg-primary-100 p-1 rounded-md'>{new Date(task.due_date).toLocaleDateString()}</span></>
          ) : (
            <>No due date</>
          )}
        </div>
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
      </div>
    </div>
  );
};

export default TaskCard;