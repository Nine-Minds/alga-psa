import React from 'react';
import {
  Activity,
  ScheduleActivity,
  ActivityPriority,
  ActivityType
} from "server/src/interfaces/activity.interfaces";
import { useActivityDrawer } from "server/src/components/user-activities/ActivityDrawerProvider";
import { useRouter } from 'next/navigation';
import { Card } from "server/src/components/ui/Card";
import { Badge } from "server/src/components/ui/Badge";
import { Button } from "server/src/components/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "server/src/components/ui/DropdownMenu";
import { MoreVertical, Repeat } from 'lucide-react';

// Format date to a readable format
const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
};

interface ActivityCardProps {
  activity: Activity;
  onViewDetails: (activity: Activity) => void;
  renderExtra?: () => React.ReactNode;
}

// Helper function to determine if an action should be shown
const shouldShowAction = (actionId: string, activityType: ActivityType) => {
  // For 'edit' action, only show for tickets and workflow tasks
  if (actionId === 'edit') {
    return activityType === ActivityType.TICKET || activityType === ActivityType.WORKFLOW_TASK;
  }
  return true;
};

export function ActivityCard({ activity, onViewDetails, renderExtra }: ActivityCardProps) {
  const { openActivityDrawer } = useActivityDrawer();
  // Color mapping based on activity type
  const typeColorMap = {
    [ActivityType.SCHEDULE]: 'border-green-500',
    [ActivityType.PROJECT_TASK]: 'border-blue-500',
    [ActivityType.TICKET]: 'border-purple-500',
    [ActivityType.TIME_ENTRY]: 'border-orange-500',
    [ActivityType.WORKFLOW_TASK]: 'border-red-500',
  };

  // Priority indicator
  const priorityIndicator = {
    [ActivityPriority.LOW]: <div className="w-2 h-2 rounded-full bg-gray-400" />,
    [ActivityPriority.MEDIUM]: <div className="w-2 h-2 rounded-full bg-yellow-400" />,
    [ActivityPriority.HIGH]: <div className="w-2 h-2 rounded-full bg-red-500" />,
  };

  const router = useRouter();
  
  const handleActionClick = (e: React.MouseEvent, actionId: string, activity: Activity) => {
    e.stopPropagation();
    
    // Handle action click based on actionId
    switch (actionId) {
      case 'view':
        // Open drawer for view action
        openActivityDrawer(activity);
        break;
      case 'edit':
        // Navigate directly to appropriate page for edit action
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
        break;
      default:
        console.log(`Action ${actionId} clicked for activity ${activity.id}`);
    }
  };

  return (
    <div
      className={`p-4 border-l-4 ${typeColorMap[activity.type]} bg-white rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
      onClick={() => openActivityDrawer(activity)}
      id={`activity-card-${activity.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 truncate">
          <h3 className="font-medium text-gray-900 truncate">{activity.title}</h3>
          {activity.type === ActivityType.SCHEDULE && (activity as ScheduleActivity).isRecurring && (
            <span title="Recurring Event">
              <Repeat className="h-4 w-4 text-gray-500 flex-shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {priorityIndicator[activity.priority]}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`${activity.type}-actions-menu-${activity.id}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {activity.actions
                .filter(action => shouldShowAction(action.id, activity.type))
                .map(action => (
                  <DropdownMenuItem
                    key={action.id}
                    id={`${action.id}-${activity.type}-menu-item-${activity.id}`}
                    onClick={(e) => handleActionClick(e, action.id, activity)}
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
        </div>
      </div>
      
      <div className="mb-3 text-sm text-gray-500 line-clamp-2">
        {activity.description || 'No description provided'}
      </div>
      
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Badge variant="default">{activity.status}</Badge>
          {activity.dueDate && (
            <span className="text-gray-500">
              Due: {formatDate(activity.dueDate)}
            </span>
          )}
        </div>
        
        {activity.assignedToNames && activity.assignedToNames.length > 0 && (
          <div className="flex -space-x-2">
            {activity.assignedToNames.map((name, i) => (
              <div
                key={i}
                className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium"
                title={name}
              >
                {name.charAt(0)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Render extra content if provided */}
      {renderExtra && renderExtra()}
    </div>
  );
}

// Specialized activity card components

export function ScheduleCard({ activity, onViewDetails }: { activity: Activity; onViewDetails: (activity: Activity) => void }) {
  const { openActivityDrawer } = useActivityDrawer();
  
  return (
    <ActivityCard
      activity={activity}
      onViewDetails={onViewDetails}
      renderExtra={() => (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">
              {activity.startDate && formatDate(activity.startDate)} - {activity.endDate && formatDate(activity.endDate)}
            </span>
          </div>
        </div>
      )}
    />
  );
}

export function ProjectTaskCard({ activity, onViewDetails }: { activity: Activity; onViewDetails: (activity: Activity) => void }) {
  const { openActivityDrawer } = useActivityDrawer();
  const projectTask = activity as any; // Type assertion for project-specific fields
  
  return (
    <ActivityCard
      activity={activity}
      onViewDetails={onViewDetails}
      renderExtra={() => (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            {projectTask.projectName && (
              <span className="text-gray-600">{projectTask.projectName}</span>
            )}
            {projectTask.estimatedHours && (
              <span className="text-gray-600">Est: {projectTask.estimatedHours}h</span>
            )}
          </div>
        </div>
      )}
    />
  );
}

export function TicketCard({ activity, onViewDetails }: { activity: Activity; onViewDetails: (activity: Activity) => void }) {
  const { openActivityDrawer } = useActivityDrawer();
  const ticket = activity as any; // Type assertion for ticket-specific fields
  
  return (
    <ActivityCard
      activity={activity}
      onViewDetails={onViewDetails}
      renderExtra={() => (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono bg-gray-100 px-1 rounded">#{ticket.ticketNumber}</span>
            {ticket.companyName && (
              <span className="text-gray-600">{ticket.companyName}</span>
            )}
          </div>
        </div>
      )}
    />
  );
}

export function TimeEntryCard({ activity, onViewDetails }: { activity: Activity; onViewDetails: (activity: Activity) => void }) {
  const { openActivityDrawer } = useActivityDrawer();
  const timeEntry = activity as any; // Type assertion for time entry-specific fields
  
  return (
    <ActivityCard
      activity={activity}
      onViewDetails={onViewDetails}
      renderExtra={() => (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">
              Duration: {(timeEntry.billableDuration / 60).toFixed(1)}h
            </span>
            {timeEntry.approvalStatus && (
              <Badge variant={timeEntry.approvalStatus === 'approved' ? 'success' : 'default'}>
                {timeEntry.approvalStatus}
              </Badge>
            )}
          </div>
        </div>
      )}
    />
  );
}

export function WorkflowTaskCard({ activity, onViewDetails }: { activity: Activity; onViewDetails: (activity: Activity) => void }) {
  const { openActivityDrawer } = useActivityDrawer();
  const workflowTask = activity as any; // Type assertion for workflow task-specific fields
  
  return (
    <ActivityCard
      activity={activity}
      onViewDetails={onViewDetails}
      renderExtra={() => (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            {workflowTask.formId && (
              <span className="text-blue-600">Has form</span>
            )}
            {workflowTask.assignedRoles && workflowTask.assignedRoles.length > 0 && (
              <span className="text-gray-600">
                Roles: {workflowTask.assignedRoles.join(', ')}
              </span>
            )}
          </div>
        </div>
      )}
    />
  );
}
