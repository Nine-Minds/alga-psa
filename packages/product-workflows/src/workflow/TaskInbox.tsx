import { TaskList } from './TaskList';
import { TaskDetailsComponent } from './TaskDetails';
import { TaskHistory } from './TaskHistory';
import { EmbeddedTaskInbox } from './EmbeddedTaskInbox';
import { WorkflowTaskStatus } from '@alga-psa/shared/workflow/persistence';
import { useState } from 'react';
import { Card } from '@server/components/ui/Card';
import { Button } from '@server/components/ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@server/components/ui/Tabs';

interface TaskInboxProps {
  className?: string;
}

/**
 * Task Inbox component
 * 
 * This is the main Task Inbox component that combines the task list
 * and task details views. It provides a complete interface for
 * managing workflow tasks.
 */
export function TaskInbox({ className = '' }: TaskInboxProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('pending');
  
  // Handle task selection
  const handleTaskSelect = (taskId: string) => {
    setSelectedTaskId(taskId);
  };
  
  // Handle task completion
  const handleTaskComplete = () => {
    setSelectedTaskId(null);
  };
  
  // Get status filter based on active tab
  const getStatusFilter = (): WorkflowTaskStatus[] => {
    switch (activeTab) {
      case 'pending':
        return [WorkflowTaskStatus.PENDING];
      case 'claimed':
        return [WorkflowTaskStatus.CLAIMED];
      case 'completed':
        return [WorkflowTaskStatus.COMPLETED];
      case 'all':
        return [
          WorkflowTaskStatus.PENDING,
          WorkflowTaskStatus.CLAIMED,
          WorkflowTaskStatus.COMPLETED,
          WorkflowTaskStatus.CANCELED,
          WorkflowTaskStatus.EXPIRED
        ];
      default:
        return [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED];
    }
  };
  
  return (
    <div className={className}>
      <Card className="p-6">
        <h1 className="text-2xl font-bold mb-6">Task Inbox</h1>
        
        {selectedTaskId ? (
          <div>
            <Button
              id="back-to-task-list"
              variant="outline"
              className="mb-4"
              onClick={() => setSelectedTaskId(null)}
            >
              ← Back to Task List
            </Button>
            
            <TaskDetailsComponent
              taskId={selectedTaskId}
              onComplete={handleTaskComplete}
            />
          </div>
        ) : (
          <div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
              <TabsList>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="claimed">Claimed</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="all">All Tasks</TabsTrigger>
              </TabsList>
            </Tabs>
            
            <TaskList
              onTaskSelect={handleTaskSelect}
              initialFilters={{
                status: getStatusFilter()
              }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

// Export all Task Inbox components
export {
  TaskList,
  TaskDetailsComponent as TaskDetails,
  TaskHistory,
  EmbeddedTaskInbox
};