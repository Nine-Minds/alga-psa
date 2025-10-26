import { useState } from 'react';
import { TaskList } from './TaskList';
import { TaskDetailsComponent } from './TaskDetails';
import { Card } from '@server/components/ui/Card';
import { Button } from '@server/components/ui/Button';
import { WorkflowTaskStatus } from '@alga-psa/shared/workflow/persistence/workflowTaskModel';

interface EmbeddedTaskInboxProps {
  maxItems?: number;
  className?: string;
  showAllTasksLink?: boolean;
}

/**
 * Embedded Task Inbox component for user activities screen
 * 
 * This component provides a compact view of the task inbox
 * that can be embedded in the user activities screen.
 */
export function EmbeddedTaskInbox({
  maxItems = 5,
  className = '',
  showAllTasksLink = true
}: EmbeddedTaskInboxProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  
  // Handle task selection
  const handleTaskSelect = (taskId: string) => {
    setSelectedTaskId(taskId);
  };
  
  // Handle task completion
  const handleTaskComplete = () => {
    setSelectedTaskId(null);
  };
  
  // Handle view all tasks
  const handleViewAllTasks = () => {
    // Navigate to the full task inbox page
    window.location.href = '/tasks';
  };
  
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">My Tasks</h2>
        {showAllTasksLink && (
          <Button
            id="view-all-tasks"
            variant="link"
            onClick={handleViewAllTasks}
          >
            View All
          </Button>
        )}
      </div>
      
      {selectedTaskId ? (
        <div>
          <Button
            id="back-to-task-list"
            variant="ghost"
            className="mb-4"
            onClick={() => setSelectedTaskId(null)}
          >
            ← Back to Tasks
          </Button>
          
          <TaskDetailsComponent
            taskId={selectedTaskId}
            onComplete={handleTaskComplete}
            embedded={true}
          />
        </div>
      ) : (
        <TaskList
          embedded={true}
          maxItems={maxItems}
          showPagination={false}
          onTaskSelect={handleTaskSelect}
          initialFilters={{
            status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
            pageSize: maxItems
          }}
        />
      )}
    </Card>
  );
}
