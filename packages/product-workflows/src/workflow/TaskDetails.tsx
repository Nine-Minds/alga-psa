import { useState, useEffect } from 'react';
import { getTaskDetails, claimTask, unclaimTask } from '@server/lib/actions/workflow-actions/taskInboxActions';
import { TaskDetails as TaskDetailsType } from '@alga-psa/shared/workflow/persistence';
import { WorkflowTaskStatus } from '@alga-psa/shared/workflow/persistence';
import { Button } from '@server/components/ui/Button';
import { Badge } from '@server/components/ui/Badge';
import { Card } from '@server/components/ui/Card';
import { TaskForm } from './TaskForm';
import { TaskHistory } from './TaskHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@server/components/ui/Tabs';

// Simple Spinner component
function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClass}`}></div>
  );
}

interface TaskDetailsProps {
  taskId: string;
  onComplete?: () => void;
  embedded?: boolean;
  className?: string;
}

/**
 * Task Details component for displaying workflow task details
 * 
 * This component displays detailed information about a task,
 * including its metadata, form, and history.
 */
export function TaskDetailsComponent({
  taskId,
  onComplete,
  embedded = false,
  className = ''
}: TaskDetailsProps) {
  const [task, setTask] = useState<TaskDetailsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('details');

  // Fetch task details when taskId changes
  useEffect(() => {
    fetchTaskDetails();
  }, [taskId]);

  // Fetch task details from the server
  const fetchTaskDetails = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const taskDetails = await getTaskDetails(taskId);
      setTask(taskDetails);
    } catch (err) {
      setError('Failed to load task details. Please try again.');
      console.error('Error fetching task details:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle task claiming
  const handleClaimTask = async () => {
    if (!task) return;
    
    setActionInProgress('claim');
    
    try {
      await claimTask(taskId);
      // Update the task status
      setTask({
        ...task,
        status: WorkflowTaskStatus.CLAIMED,
        claimedBy: 'me',
        claimedAt: new Date().toISOString()
      });
    } catch (err) {
      setError(`Failed to claim task: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error claiming task:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle task unclaiming
  const handleUnclaimTask = async () => {
    if (!task) return;
    
    setActionInProgress('unclaim');
    
    try {
      await unclaimTask(taskId);
      // Update the task status
      setTask({
        ...task,
        status: WorkflowTaskStatus.PENDING,
        claimedBy: undefined,
        claimedAt: undefined
      });
    } catch (err) {
      setError(`Failed to unclaim task: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error unclaiming task:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle task completion
  const handleTaskComplete = () => {
    if (onComplete) {
      onComplete();
    } else {
      // Refresh the task details
      fetchTaskDetails();
    }
  };

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
  };

  // Render priority badge
  const renderPriorityBadge = (priority: string) => {
    let variant: 'default' | 'primary' | 'success' | 'warning' | 'error' = 'default';
    
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
      <Badge variant={variant}>
        {priority}
      </Badge>
    );
  };

  // Render task status badge
  const renderStatusBadge = (status: WorkflowTaskStatus) => {
    let variant: 'default' | 'primary' | 'success' | 'warning' | 'error' = 'default';
    
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
  const renderTaskActions = () => {
    if (!task) return null;
    
    const isActionDisabled = actionInProgress !== null;
    
    if (task.status === WorkflowTaskStatus.PENDING) {
      return (
        <Button
          id={`claim-task-${taskId}`}
          variant="outline"
          onClick={handleClaimTask}
          disabled={isActionDisabled}
        >
          {actionInProgress === 'claim' ? <Spinner size="sm" /> : 'Claim Task'}
        </Button>
      );
    }
    
    if (task.status === WorkflowTaskStatus.CLAIMED && task.claimedBy === 'me') {
      return (
        <Button
          id={`unclaim-task-${taskId}`}
          variant="outline"
          onClick={handleUnclaimTask}
          disabled={isActionDisabled}
        >
          {actionInProgress === 'unclaim' ? <Spinner size="sm" /> : 'Unclaim Task'}
        </Button>
      );
    }
    
    return null;
  };

  // Render loading state
  if (loading) {
    return (
      <div className={`flex justify-center items-center p-8 ${className}`}>
        <Spinner size="lg" />
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={`bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded ${className}`}>
        <p>{error}</p>
        <Button
          id="retry-load-task"
          variant="outline"
          onClick={fetchTaskDetails}
          className="mt-2"
        >
          Retry
        </Button>
      </div>
    );
  }

  // Render not found state
  if (!task) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">Task not found</p>
      </div>
    );
  }

  // Determine if the task is actionable by the current user
  const isTaskActionable = task.status === WorkflowTaskStatus.CLAIMED && task.claimedBy === 'me';

  return (
    <div className={className}>
      <Card className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold">{task.title}</h2>
            {task.description && (
              <p className="text-gray-600 mt-1">{task.description}</p>
            )}
          </div>
          <div>
            {renderTaskActions()}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <div className="mt-1">{renderStatusBadge(task.status)}</div>
          </div>
          <div>
            <p className="text-sm text-gray-500">Priority</p>
            <div className="mt-1">{renderPriorityBadge(task.priority)}</div>
          </div>
          <div>
            <p className="text-sm text-gray-500">Created</p>
            <p className="mt-1">{formatDate(task.createdAt)}</p>
          </div>
          {task.dueDate && (
            <div>
              <p className="text-sm text-gray-500">Due Date</p>
              <p className="mt-1">{formatDate(task.dueDate)}</p>
            </div>
          )}
          {task.claimedBy && (
            <div>
              <p className="text-sm text-gray-500">Claimed By</p>
              <p className="mt-1">{task.claimedBy === 'me' ? 'You' : task.claimedBy}</p>
            </div>
          )}
          {task.completedBy && (
            <div>
              <p className="text-sm text-gray-500">Completed By</p>
              <p className="mt-1">{task.completedBy === 'me' ? 'You' : task.completedBy}</p>
            </div>
          )}
        </div>
        
        {/* Tabs for different sections */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details">
            {task.contextData && Object.keys(task.contextData).length > 0 && (
              <div className="mt-4">
                <h3 className="text-lg font-medium mb-2">Context Data</h3>
                <div className="bg-gray-50 p-4 rounded-md">
                  <pre className="text-sm whitespace-pre-wrap">
                    {JSON.stringify(task.contextData, null, 2)}
                  </pre>
                </div>
              </div>
            )}
            
            {task.responseData && Object.keys(task.responseData).length > 0 && (
              <div className="mt-4">
                <h3 className="text-lg font-medium mb-2">Response Data</h3>
                <div className="bg-gray-50 p-4 rounded-md">
                  <pre className="text-sm whitespace-pre-wrap">
                    {JSON.stringify(task.responseData, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="form">
            {task.formSchema ? (
              <TaskForm
                taskId={taskId}
                schema={task.formSchema.jsonSchema}
                uiSchema={task.formSchema.uiSchema || {}}
                initialFormData={task.responseData || task.formSchema.defaultValues || {}}
                onComplete={handleTaskComplete}
                contextData={task.contextData}
                executionId={task.executionId}
              />
            ) : (
              <p className="text-gray-500">No form available for this task.</p>
            )}
          </TabsContent>
          
          <TabsContent value="history">
            <TaskHistory taskId={taskId} />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}