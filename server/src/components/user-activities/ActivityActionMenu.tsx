import React from 'react';
import { Activity, ActivityType } from "server/src/interfaces/activity.interfaces";
import { Button } from "server/src/components/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "server/src/components/ui/DropdownMenu";
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActivityDrawer } from "server/src/components/user-activities/ActivityDrawerProvider";
import {
  updateActivityStatus,
  reassignActivity
} from "server/src/lib/actions/activity-actions/activityStatusActions";
import {
  cancelWorkflowTask,
  reassignWorkflowTask,
  submitTaskForm
} from "server/src/lib/actions/activity-actions/workflowTaskActions";

interface ActivityActionMenuProps {
  activity: Activity;
  onActionComplete?: () => void;
  onViewDetails?: (activity: Activity) => void; // New prop for handling view details
}

export function ActivityActionMenu({ activity, onActionComplete, onViewDetails }: ActivityActionMenuProps) {
  const { openActivityDrawer } = useActivityDrawer();
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
    // Use the drawer system for all activity types
    openActivityDrawer(activity);
  };

  // Handle edit action based on activity type
  const handleEditAction = () => {
    switch (activity.type) {
      case ActivityType.SCHEDULE:
        router.push(`/msp/schedule/entries/${activity.id}`);
        break;
      case ActivityType.PROJECT_TASK:
        router.push(`/msp/projects/tasks/${activity.id}`);
        break;
      case ActivityType.TICKET:
        router.push(`/msp/tickets/${activity.id}`);
        break;
      case ActivityType.TIME_ENTRY:
        router.push(`/msp/time-management/entries/${activity.id}`);
        break;
      case ActivityType.WORKFLOW_TASK:
        router.push(`/msp/workflow/tasks/${activity.id}`);
        break;
    }
  };

  // Handle complete action
  const handleCompleteAction = async () => {
    if (activity.type === ActivityType.WORKFLOW_TASK) {
      // For workflow tasks with forms, use the drawer
      const workflowTask = activity as any; // Type assertion for workflow-specific fields
      if (workflowTask.formId) {
        // Use the drawer to show the form
        openActivityDrawer(activity);
        return;
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

  // Helper function to determine if an action should be shown
  const shouldShowAction = (actionId: string) => {
    // For 'edit' action, only show for tickets and workflow tasks
    if (actionId === 'edit') {
      return activity.type === ActivityType.TICKET || activity.type === ActivityType.WORKFLOW_TASK;
    }
    return true;
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
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {activity.actions
          .filter(action => shouldShowAction(action.id))
          .map(action => (
            <DropdownMenuItem
              key={action.id}
              id={`${action.id}-${activity.type}-menu-item-${activity.id}`}
              onClick={() => handleActionClick(action.id)}
              disabled={action.disabled}
            >
              {action.id === 'edit' ? 'Go to page' : action.label}
              {action.disabledReason && action.disabled && (
                <span className="text-xs text-gray-400 ml-2">{action.disabledReason}</span>
              )}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}