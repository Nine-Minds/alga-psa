import React, { useState } from 'react';
import { 
  Activity, 
  ActivityType, 
  ActivityPriority 
} from '../../interfaces/activity.interfaces';
import { DataTable } from '../ui/DataTable';
import { ColumnDefinition } from '../../interfaces/dataTable.interfaces';
import { Badge } from '../ui/Badge';
import { formatDistanceToNow } from 'date-fns';
import { ActivityActionMenu } from './ActivityActionMenu';
import { AlertTriangle, Calendar, Briefcase, TicketIcon, Clock, ListChecks } from 'lucide-react';

interface ActivitiesDataTableProps {
  activities: Activity[];
  onViewDetails: (activity: Activity) => void;
  onActionComplete?: () => void;
  isLoading?: boolean;
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
    default:
      return 'Unknown';
  }
};

export function ActivitiesDataTable({ 
  activities, 
  onViewDetails, 
  onActionComplete,
  isLoading = false
}: ActivitiesDataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Define columns for the DataTable
  const columns: ColumnDefinition<Activity>[] = [
    {
      title: 'Type',
      dataIndex: 'type',
      width: '100px',
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
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{value}</span>
          {record.priority === ActivityPriority.HIGH && (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: '120px',
      render: (value) => (
        <Badge variant="default">{value}</Badge>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      width: '100px',
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
      width: '150px',
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
      title: 'Assigned To',
      dataIndex: 'assignedToNames',
      width: '150px',
      render: (value, record) => (
        <div>
          {value && (value as string[]).length > 0 ? (
            <div className="flex -space-x-2">
              {(value as string[]).map((name, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium"
                  title={name}
                >
                  {name.charAt(0)}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-gray-400">Unassigned</span>
          )}
        </div>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '80px',
      render: (_, record) => (
        <ActivityActionMenu
          activity={record}
          onActionComplete={onActionComplete}
          onViewDetails={onViewDetails}
        />
      ),
    },
  ];

  // Handle row click to view details
  const handleRowClick = (record: Activity) => {
    onViewDetails(record);
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <DataTable
      id="activities-data-table"
      data={activities}
      columns={columns}
      pagination={true}
      onRowClick={handleRowClick}
      currentPage={currentPage}
      onPageChange={handlePageChange}
      pageSize={pageSize}
      totalItems={activities.length}
    />
  );
}