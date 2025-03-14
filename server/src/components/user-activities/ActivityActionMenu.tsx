import React from 'react';
import { Activity, ActivityType } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/DropdownMenu';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { 
  updateActivityStatus, 
  reassignActivity 
} from '../../lib/actions/activity-actions/activityStatusActions';
import { 
  cancelWorkflowTask, 
  reassignWorkflowTask, 
  submitTaskForm 
} from '../../lib/actions/activity-actions/workflowTaskActions';

interface ActivityActionMenuProps {
  activity: Activity;
  onActionComplete?: () => void;
  onViewDetails?: (activity: Activity) => void; // New prop for handling view details
}

export function ActivityActionMenu({ activity, onActionComplete, onViewDetails }: ActivityActionMenuProps) {
  const router = useRouter();
  
  const handleActionClick = async (actionId: string) => {
    try {
      switch (actionId) {
        case 'view':
          handleViewAction();
          break;
        case 'edit':
          handleEditAction();
          break;
        case 'complete':
          await handleCompleteAction();
          break;
        case 'cancel':
          await handleCancelAction();
          break;
        case 'reassign':
          handleReassignAction();
          break;
        default:
          console.warn(`Unknown action: ${actionId}`);
      }
      
      // Call the onActionComplete callback if provided
      if (onActionComplete) {
        onActionComplete();
      }
    } catch (error) {
      console.error(`Error handling action ${actionId}:`, error);
      // Here you could show an error notification
    }
  };

  // Handle view action based on activity type
  const handleViewAction = () => {
    // If onViewDetails is provided and this is a workflow task, use the drawer
    if (onViewDetails && activity.type === ActivityType.WORKFLOW_TASK) {
      onViewDetails(activity);
      return;
    }
    
    // Otherwise, navigate to the appropriate route
    switch (activity.type) {
      case ActivityType.SCHEDULE:
        router.push(`/schedule/${activity.id}`);
        break;
      case ActivityType.PROJECT_TASK:
        router.push(`/projects/tasks/${activity.id}`);
        break;
      case ActivityType.TICKET:
        router.push(`/tickets/${activity.id}`);
        break;
      case ActivityType.TIME_ENTRY:
        router.push(`/time-entries/${activity.id}`);
        break;
      case ActivityType.WORKFLOW_TASK:
        // If we get here, onViewDetails wasn't provided, so try to navigate
        // This is a fallback, but the route might not exist
        router.push(`/tasks/${activity.id}`);
        break;
    }
  };

  // Handle edit action based on activity type
  const handleEditAction = () => {
    switch (activity.type) {
      case ActivityType.SCHEDULE:
        router.push(`/schedule/${activity.id}/edit`);
        break;
      case ActivityType.PROJECT_TASK:
        router.push(`/projects/tasks/${activity.id}/edit`);
        break;
      case ActivityType.TICKET:
        router.push(`/tickets/${activity.id}/edit`);
        break;
      case ActivityType.TIME_ENTRY:
        router.push(`/time-entries/${activity.id}/edit`);
        break;
      case ActivityType.WORKFLOW_TASK:
        router.push(`/tasks/${activity.id}/edit`);
        break;
    }
  };

  // Handle complete action
  const handleCompleteAction = async () => {
    if (activity.type === ActivityType.WORKFLOW_TASK) {
      // For workflow tasks with forms, use the drawer if available
      const workflowTask = activity as any; // Type assertion for workflow-specific fields
      if (workflowTask.formId) {
        if (onViewDetails) {
          // Use the drawer to show the form
          onViewDetails(activity);
          return;
        } else {
          // Fallback to navigation if drawer isn't available
          router.push(`/tasks/${activity.id}/form`);
        }
      } else {
        // For workflow tasks without forms, mark as completed
        await updateActivityStatus(activity.id, activity.type, 'completed');
      }
    } else {
      // For other activity types, update status to completed
      await updateActivityStatus(activity.id, activity.type, 'completed');
    }
  };

  // Handle cancel action
  const handleCancelAction = async () => {
    if (activity.type === ActivityType.WORKFLOW_TASK) {
      await cancelWorkflowTask(activity.id);
    } else {
      await updateActivityStatus(activity.id, activity.type, 'cancelled');
    }
  };

  // Handle reassign action
  const handleReassignAction = () => {
    // For now, just redirect to the reassign page
    // In a real implementation, you might show a dialog to select a user
    router.push(`/${activity.type}s/${activity.id}/reassign`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={`${activity.type}-actions-menu-${activity.id}`}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
        >
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {activity.actions.map(action => (
          <DropdownMenuItem
            key={action.id}
            id={`${action.id}-${activity.type}-menu-item-${activity.id}`}
            onClick={() => handleActionClick(action.id)}
            disabled={action.disabled}
          >
            {action.label}
            {action.disabledReason && action.disabled && (
              <span className="text-xs text-gray-400 ml-2">{action.disabledReason}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}