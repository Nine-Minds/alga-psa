import { useState, useEffect } from 'react';
import { getUserTasks, claimTask, unclaimTask } from '@product/actions/workflow-actions/taskInboxActions';
import { TaskDetails, TaskQueryParams } from '@alga-psa/shared/workflow/persistence/taskInboxInterfaces';
import { WorkflowTaskStatus } from '@alga-psa/shared/workflow/persistence/workflowTaskModel';
import { Button } from '@server/components/ui/Button';
import { Badge, BadgeVariant } from '@server/components/ui/Badge';
import { Card } from '@server/components/ui/Card';
import { useRouter } from 'next/navigation';

// Simple Spinner component
function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClass}`}></div>
  );
}

// Simple Pagination component
function Pagination({
  currentPage,
  totalPages,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center space-x-2">
      <Button
        id="prev-page"
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        Previous
      </Button>
      <span className="text-sm">
        Page {currentPage} of {totalPages}
      </span>
      <Button
        id="next-page"
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        Next
      </Button>
    </div>
  );
}

interface TaskListProps {
  embedded?: boolean;
  initialFilters?: Partial<TaskQueryParams>;
  onTaskSelect?: (taskId: string) => void;
  maxItems?: number;
  showPagination?: boolean;
  className?: string;
}

/**
 * Task List component for displaying workflow tasks
 * 
 * This component displays a list of tasks assigned to the current user
 * or available for claiming. It supports filtering, pagination, and
 * task actions like claiming and viewing details.
 */
export function TaskList({
  embedded = false,
  initialFilters = {},
  onTaskSelect,
  maxItems = 10,
  showPagination = true,
  className = ''
}: TaskListProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskQueryParams>({
    status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    page: 1,
    pageSize: maxItems,
    ...initialFilters
  });
  const [totalPages, setTotalPages] = useState(1);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Fetch tasks when filters change
  useEffect(() => {
    fetchTasks();
  }, [filters]);

  // Fetch tasks from the server
  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await getUserTasks(filters);
      setTasks(result.tasks);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError('Failed to load tasks. Please try again.');
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle task claiming
  const handleClaimTask = async (taskId: string) => {
    setActionInProgress(taskId);
    
    try {
      await claimTask(taskId);
      // Update the task in the list
      setTasks(tasks.map(task => 
        task.taskId === taskId 
          ? { ...task, status: WorkflowTaskStatus.CLAIMED, claimedBy: 'me' } 
          : task
      ));
    } catch (err) {
      setError(`Failed to claim task: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error claiming task:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle task unclaiming
  const handleUnclaimTask = async (taskId: string) => {
    setActionInProgress(taskId);
    
    try {
      await unclaimTask(taskId);
      // Update the task in the list
      setTasks(tasks.map(task => 
        task.taskId === taskId 
          ? { ...task, status: WorkflowTaskStatus.PENDING, claimedBy: undefined } 
          : task
      ));
    } catch (err) {
      setError(`Failed to unclaim task: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error unclaiming task:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle task selection
  const handleTaskSelect = (taskId: string) => {
    if (onTaskSelect) {
      onTaskSelect(taskId);
    } else {
      // Navigate to task details page if no onTaskSelect handler
      router.push(`/tasks/${taskId}`);
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  // Render priority badge
  const renderPriorityBadge = (priority: string) => {
    let variant: BadgeVariant = 'default';
    
    switch (priority.toLowerCase()) {
      case 'high':
        variant = 'error';
        break;
      case 'medium':
        variant = 'warning';
        break;
      case 'low':
        variant = 'primary';
        break;
    }
    
    return (
      <Badge variant={variant} className="ml-2">
        {priority}
      </Badge>
    );
  };

  // Format due date
  const formatDueDate = (dueDate?: string) => {
    if (!dueDate) return 'No due date';
    
    const date = new Date(dueDate);
    const now = new Date();
    const isOverdue = date < now;
    
    // Format: Mar 7, 2025
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    
    return (
      <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
        {formatted} {isOverdue && '(Overdue)'}
      </span>
    );
  };

  // Render task status
  const renderTaskStatus = (status: WorkflowTaskStatus) => {
    let variant: BadgeVariant = 'default';
    
    switch (status) {
      case WorkflowTaskStatus.PENDING:
        variant = 'primary';
        break;
      case WorkflowTaskStatus.CLAIMED:
        variant = 'default';
        break;
      case WorkflowTaskStatus.COMPLETED:
        variant = 'success';
        break;
      case WorkflowTaskStatus.CANCELED:
        variant = 'error';
        break;
      case WorkflowTaskStatus.EXPIRED:
        variant = 'warning';
        break;
    }
    
    return (
      <Badge variant={variant}>
        {status}
      </Badge>
    );
  };

  // Render task actions
  const renderTaskActions = (task: TaskDetails) => {
    const isActionDisabled = actionInProgress !== null;
    const isThisTaskInProgress = actionInProgress === task.taskId;
    
    if (task.status === WorkflowTaskStatus.PENDING) {
      return (
        <Button
          id={`claim-task-${task.taskId}`}
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            handleClaimTask(task.taskId);
          }}
          disabled={isActionDisabled}
        >
          {isThisTaskInProgress ? <Spinner size="sm" /> : 'Claim'}
        </Button>
      );
    }
    
    if (task.status === WorkflowTaskStatus.CLAIMED && task.claimedBy === 'me') {
      return (
        <Button
          id={`unclaim-task-${task.taskId}`}
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            handleUnclaimTask(task.taskId);
          }}
          disabled={isActionDisabled}
        >
          {isThisTaskInProgress ? <Spinner size="sm" /> : 'Unclaim'}
        </Button>
      );
    }
    
    return null;
  };

  // Render empty state
  if (!loading && tasks.length === 0) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">No tasks found</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {loading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div className={`space-y-3 ${embedded ? 'max-h-[400px] overflow-y-auto' : ''}`}>
            {tasks.map((task) => (
              <Card
                key={task.taskId}
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleTaskSelect(task.taskId)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center">
                      <h3 className="text-lg font-medium">{task.title}</h3>
                      {renderPriorityBadge(task.priority)}
                    </div>
                    {task.description && (
                      <p className="text-gray-600 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {renderTaskStatus(task.status)}
                      {task.dueDate && (
                        <div className="text-sm text-gray-500">
                          Due: {formatDueDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    {renderTaskActions(task)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          
          {showPagination && totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination
                currentPage={filters.page || 1}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}