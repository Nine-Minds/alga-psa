import React, { useState, useMemo, useCallback } from 'react';
import {
  Activity,
  ActivityType,
  ActivityPriority,
  ScheduleActivity,
  NotificationActivity
} from 'server/src/interfaces/activity.interfaces';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Badge } from '@alga-psa/ui/components/Badge';
import { formatDistanceToNow } from 'date-fns';
import { ActivityActionMenu } from './ActivityActionMenu';
import { AlertTriangle, Calendar, Briefcase, TicketIcon, Clock, ListChecks, Repeat, Bell } from 'lucide-react';

interface ActivitiesDataTableProps {
  activities: Activity[];
  onViewDetails: (activity: Activity) => void;
  onActionComplete?: () => void;
  isLoading?: boolean;
  currentPage?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onItemsPerPageChange?: (pageSize: number) => void;
}

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

// Get relative time (e.g., "2 days ago")
const getRelativeTime = (dateString?: string) => {
  if (!dateString) return '';
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};

// Get activity type icon
const getActivityTypeIcon = (type: ActivityType) => {
  switch (type) {
    case ActivityType.SCHEDULE:
      return <Calendar className="h-4 w-4 text-blue-500" />;
    case ActivityType.PROJECT_TASK:
      return <Briefcase className="h-4 w-4 text-green-500" />;
    case ActivityType.TICKET:
      return <TicketIcon className="h-4 w-4 text-purple-500" />;
    case ActivityType.TIME_ENTRY:
      return <Clock className="h-4 w-4 text-orange-500" />;
    case ActivityType.WORKFLOW_TASK:
      return <ListChecks className="h-4 w-4 text-red-500" />;
    case ActivityType.NOTIFICATION:
      return <Bell className="h-4 w-4 text-indigo-500" />;
    default:
      return null;
  }
};

// Get priority icon
const getPriorityIcon = (priority: ActivityPriority) => {
  switch (priority) {
    case ActivityPriority.HIGH:
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case ActivityPriority.MEDIUM:
      return <div className="w-2 h-2 rounded-full bg-yellow-400" />;
    case ActivityPriority.LOW:
      return <div className="w-2 h-2 rounded-full bg-gray-400" />;
    default:
      return null;
  }
};

// Get activity type label
const getActivityTypeLabel = (type: ActivityType) => {
  switch (type) {
    case ActivityType.SCHEDULE:
      return 'Schedule';
    case ActivityType.PROJECT_TASK:
      return 'Project Task';
    case ActivityType.TICKET:
      return 'Ticket';
    case ActivityType.TIME_ENTRY:
      return 'Time Entry';
    case ActivityType.WORKFLOW_TASK:
      return 'Workflow Task';
    case ActivityType.NOTIFICATION:
      return 'Notification';
    default:
      return 'Unknown';
  }
};

// Wrap the entire component in React.memo for top-level memoization
export const ActivitiesDataTable = React.memo(function ActivitiesDataTable({
  activities,
  onViewDetails,
  onActionComplete,
  isLoading = false,
  currentPage = 1,
  pageSize = 10,
  totalItems,
  onPageChange,
  onItemsPerPageChange
}: ActivitiesDataTableProps) {
  const { openActivityDrawer } = useActivityDrawer();

  // Define columns for the DataTable - memoized to prevent unnecessary re-renders
  const columns = useMemo<ColumnDefinition<Activity>[]>(() => [
    {
      title: 'Type',
      dataIndex: 'type',
      width: '10%',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {getActivityTypeIcon(value as ActivityType)}
          <span className="text-xs">{getActivityTypeLabel(value as ActivityType)}</span>
        </div>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      width: '50%',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 break-words">{value}</span>
          {record.type === ActivityType.SCHEDULE && (record as ScheduleActivity).isRecurring && (
             <span title="Recurring Event">
               <Repeat className="h-4 w-4 text-gray-500 flex-shrink-0" />
             </span>
          )}
          {record.type === ActivityType.NOTIFICATION && !(record as NotificationActivity).isRead && (
            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Unread" />
          )}
          {record.priority === ActivityPriority.HIGH && (
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 ml-1" />
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: '15%',
      render: (value) => (
        <Badge variant="default">{value}</Badge>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      width: '10%',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {getPriorityIcon(value as ActivityPriority)}
          <span className="capitalize">{value}</span>
        </div>
      ),
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      width: '10%',
      render: (value, record) => (
        <div>
          {value ? (
            <div className="flex flex-col">
              <span>{formatDate(value as string)}</span>
              <span className="text-xs text-gray-500">{getRelativeTime(value as string)}</span>
            </div>
          ) : (
            <span className="text-gray-400">No due date</span>
          )}
        </div>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '5%',
      render: (_, record) => (
        <ActivityActionMenu
          activity={record}
          onActionComplete={onActionComplete}
          onViewDetails={onViewDetails}
        />
      ),
    },
  ], [onActionComplete, onViewDetails]);  // Add dependencies that are used in the columns

  // Handle row click to view details - memoized to prevent unnecessary re-renders
  const handleRowClick = useCallback((record: Activity) => {
    openActivityDrawer(record);
  }, [openActivityDrawer]);

  // Memoize the entire DataTable component to prevent unnecessary re-renders
  const MemoizedDataTable = useMemo(() => (
    <DataTable
      key={`${currentPage}-${pageSize}`}
      id="user-activities-table"
      data={activities}
      columns={columns}
      pagination={true}
      onRowClick={handleRowClick}
      currentPage={currentPage}
      onPageChange={onPageChange}
      pageSize={pageSize}
      totalItems={totalItems}
      onItemsPerPageChange={onItemsPerPageChange}
    />
  ), [
    activities,
    columns,
    handleRowClick,
    currentPage,
    onPageChange,
    pageSize,
    totalItems,
    onItemsPerPageChange
  ]);
  
  return MemoizedDataTable;
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Return true if the component should NOT re-render
  
  // Check if activities array has changed (length or content)
  if (prevProps.activities.length !== nextProps.activities.length) {
    return false; // Re-render if length changed
  }
  
  // Check if pagination props changed
  if (
    prevProps.currentPage !== nextProps.currentPage ||
    prevProps.pageSize !== nextProps.pageSize ||
    prevProps.totalItems !== nextProps.totalItems
  ) {
    return false; // Re-render if pagination changed
  }
  
  // Check if loading state changed
  if (prevProps.isLoading !== nextProps.isLoading) {
    return false; // Re-render if loading state changed
  }
  
  // For activities, we need a deeper comparison
  // This is a simplified approach - for large datasets, consider using a more efficient comparison
  const prevIds = prevProps.activities.map(a => a.id).join(',');
  const nextIds = nextProps.activities.map(a => a.id).join(',');
  if (prevIds !== nextIds) {
    return false; // Re-render if activities changed
  }
  
  // If we got here, don't re-render
  return true;
});
