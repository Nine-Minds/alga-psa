import React, { useState, useEffect } from 'react';
import { 
  ITimeSheet, 
  ITimeEntry, 
  ITimeSheetComment, 
  ITimeSheetApproval, 
  ITimeSheetApprovalView,
  ITimeEntryWithWorkItem, 
  TimeSheetStatus 
} from '@alga-psa/types';
import { addCommentToTimeSheet, fetchTimeSheetComments } from '../../../actions/timeSheetActions';
import { Check, Clock, Undo, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { IWorkItem } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { IUser } from '@alga-psa/types';
import { fetchWorkItemsForTimeSheet, saveTimeEntry } from '../../../actions/timeEntryActions';
import { parseISO } from 'date-fns';
import { Temporal } from '@js-temporal/polyfill';

interface TimeSheetApprovalProps {
  timeSheet: ITimeSheetApprovalView;
  timeEntries: ITimeEntry[];
  currentUser: IUser;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReverseApproval?: () => void;
}


interface TimeEntryDetailPanelProps {
  entry: ITimeEntryWithWorkItem;
  onUpdateApprovalStatus: (entryId: string, status: TimeSheetStatus) => void;
}


interface StatusIconProps {
  status: TimeSheetStatus;
}

// Badge variants align with TimePeriodList, TimeSheetHeader, and ManagerApprovalDashboard
const statusConfig: Record<string, { icon: typeof Check; iconColor: string; label: string; badgeVariant: 'secondary' | 'success' | 'warning' | 'outline' }> = {
  SUBMITTED: { icon: Send, iconColor: 'text-secondary-600', label: 'Submitted', badgeVariant: 'secondary' },
  APPROVED: { icon: Check, iconColor: 'text-green-800', label: 'Approved', badgeVariant: 'success' },
  CHANGES_REQUESTED: { icon: Undo, iconColor: 'text-orange-800', label: 'Changes Requested', badgeVariant: 'warning' },
};

const getStatusConfig = (status: string) =>
  statusConfig[status] ?? { icon: Clock, iconColor: 'text-gray-500', label: status, badgeVariant: 'outline' as const };

const StatusIcon: React.FC<StatusIconProps> = ({ status }) => {
  const config = getStatusConfig(status);
  const Icon = config.icon;
  return <Icon className={`w-5 h-5 ${config.iconColor}`} />;
};

const StatusBadge: React.FC<StatusIconProps> = ({ status }) => {
  const config = getStatusConfig(status);
  return <Badge variant={config.badgeVariant} className="py-1">{config.label}</Badge>;
};

const formatDuration = (decimalHours: number) => {
  const h = Math.floor(decimalHours);
  const m = Math.round((decimalHours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

const TimeEntryDetailPanel: React.FC<TimeEntryDetailPanelProps> = ({ entry, onUpdateApprovalStatus }) => {
  const [approvalStatus, setApprovalStatus] = useState<TimeSheetStatus>(entry.approval_status);

  const handleStatusChange = (newStatus: TimeSheetStatus) => {
    setApprovalStatus(newStatus);
    onUpdateApprovalStatus(entry.entry_id as string, newStatus);
  };

  const statusButtons: Array<{
    status: TimeSheetStatus;
    icon: typeof Check;
    label: string;
    variant: 'default' | 'destructive' | 'outline';
  }> = [
    { status: 'APPROVED', icon: Check, label: 'Approve', variant: 'default' },
    { status: 'CHANGES_REQUESTED', icon: Undo, label: 'Request Changes', variant: 'destructive' },
  ];

  const formatType = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="p-4 bg-[rgb(var(--color-border-100))] border-t border-b border-[rgb(var(--color-border-200))]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-[rgb(var(--color-text-900))]">Time Entry Details</h4>
        <StatusBadge status={entry.approval_status} />
      </div>
      <div className="grid grid-cols-2 gap-y-2 text-sm mb-3">
        <span className="font-medium text-[rgb(var(--color-text-900))]">Work Item</span>
        <span className="text-[rgb(var(--color-text-700))]">{entry.workItem ? `${entry.workItem.name} (${formatType(entry.workItem.type)})` : 'N/A'}</span>
        <span className="font-medium text-[rgb(var(--color-text-900))]">Duration</span>
        <span className="text-[rgb(var(--color-text-700))]">{formatDuration((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / (1000 * 60 * 60))}</span>
        <span className="font-medium text-[rgb(var(--color-text-900))]">Billable</span>
        <span className="text-[rgb(var(--color-text-700))]">{formatDuration(entry.billable_duration / 60)}</span>
      </div>
      {entry.notes && (
        <div className="mb-3">
          <span className="text-sm font-medium text-[rgb(var(--color-text-900))]">Notes</span>
          <p className="text-sm whitespace-pre-wrap text-[rgb(var(--color-text-600))] mt-1">{entry.notes}</p>
        </div>
      )}
      <div className="flex space-x-2 pt-3 border-t border-[rgb(var(--color-border-200))]">
        {statusButtons.map(({ status, icon: Icon, label, variant }): React.JSX.Element => (
          <Button
            id={`update-status-${status}-btn`}
            key={status}
            onClick={() => handleStatusChange(status)}
            variant={variant}
            disabled={entry.approval_status === status}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
};

export function TimeSheetApproval({
  timeSheet: initialTimeSheet,
  timeEntries,
  currentUser,
  onApprove,
  onRequestChanges,
  onReverseApproval
}: TimeSheetApprovalProps) {
  const [timeSheet, setTimeSheet] = useState<ITimeSheetApprovalView>(initialTimeSheet);
  const [newComment, setNewComment] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [workItems, setWorkItems] = useState<IWorkItem[]>([]);
  const [entriesWithWorkItems, setEntriesWithWorkItems] = useState<ITimeEntryWithWorkItem[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [isAddingComment, setIsAddingComment] = useState(false);


  const toggleEntryDetails = (entryId: string) => {
    setExpandedEntryId(expandedEntryId === entryId ? null : entryId);
  };

  const handleUpdateApprovalStatus = async (entryId: string, status: TimeSheetStatus) => {
    try {
      // Find the entry to update
      const entryToUpdate = entriesWithWorkItems.find(entry => entry.entry_id === entryId);

      if (!entryToUpdate) {
        throw new Error('Time entry not found');
      }

      // Create an updated entry object
      const { ...entryWithoutWorkItem } = entryToUpdate;
      const updatedEntry: ITimeEntry = {
        ...entryWithoutWorkItem,
        approval_status: status,
      };

      // Call the API to update the time entry
      await saveTimeEntry(updatedEntry);

      // Update the local state
      setEntriesWithWorkItems(prevEntries =>
        prevEntries.map((entry):ITimeEntryWithWorkItem =>
          entry.entry_id === entryId ? { ...entry, approval_status: status } : entry
        )
      );

      // Show a success notification
      // toast.success(`Time entry status updated to ${status}`);

      // Check if all entries are now approved
      const allApproved = entriesWithWorkItems.every(entry =>
        entry.entry_id === entryId ? status === 'APPROVED' : entry.approval_status === 'APPROVED'
      );

      if (allApproved) {
        // If all entries are approved, call the onApprove function to update the overall timesheet status
        await onApprove();
        // toast.success('All time entries approved. Timesheet status updated.');
      }

    } catch (error) {
      console.error('Failed to update time entry status:', error);
      // toast.error('Failed to update time entry status. Please try again.');
    }
  };

  useEffect(() => {
    async function fetchWorkItems() {
      const fetchedWorkItems = await fetchWorkItemsForTimeSheet(timeSheet.id);
      setWorkItems(fetchedWorkItems);

      // Combine time entries with work items
      const combinedEntries = timeEntries.map((entry):ITimeEntryWithWorkItem => {
        const workItem = fetchedWorkItems.find(item => item.work_item_id === entry.work_item_id);
        return { ...entry, workItem } as ITimeEntryWithWorkItem;
      });
      setEntriesWithWorkItems(combinedEntries);
    }
    fetchWorkItems();
  }, [timeSheet, timeEntries]);

  // Calculate summary statistics
  const totalHours = timeEntries.reduce((sum, entry) => {
    const totalDuration = (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / (1000 * 60 * 60);
    return sum + totalDuration;
  }, 0);
  const totalBillableHours = timeEntries.reduce((sum, entry) => sum + entry.billable_duration / 60, 0);
  const totalNonBillableHours = totalHours - totalBillableHours;

  // Group entries by work item type
  const entriesByType = timeEntries.reduce((acc, entry) => {
    const totalDuration = (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / (1000 * 60 * 60);
    acc[entry.work_item_type] = (acc[entry.work_item_type] || 0) + totalDuration;
    return acc;
  }, {} as Record<string, number>);

  // Group entries by date
  const entriesByDate = timeEntries.reduce((acc, entry) => {
    const date = new Date(entry.start_time).toDateString();
    const totalDuration = (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / (1000 * 60 * 60);
    acc[date] = (acc[date] || 0) + totalDuration;
    return acc;
  }, {} as Record<string, number>);

  const handleAddComment = async () => {
    if (newComment.trim() && !isAddingComment) {
      setIsAddingComment(true);
      try {
        await addCommentToTimeSheet(
          timeSheet.id,
          currentUser.user_id,
          newComment,
          true
        );

        // Fetch updated comments
        const updatedComments = await fetchTimeSheetComments(timeSheet.id);
        
        setTimeSheet(prevTimeSheet => ({
          ...prevTimeSheet,
          comments: updatedComments
        }));

        setNewComment('');
      } catch (error) {
        console.error('Failed to add comment:', error);
        // Show error message to user
      } finally {
        setIsAddingComment(false);
      }
    }
  };

  const formatWorkItem = (workItem?: IWorkItem) => {
    if (!workItem) return 'N/A';
    return `${workItem.name} (${workItem.type})`;
  };

  const formatWorkItemType = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const formatSubmittedDate = (date?: Date | string | null) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Time Sheet Approval for {timeSheet.employee_name}</CardTitle>
            <StatusBadge status={timeSheet.approval_status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-y-2 text-sm text-[rgb(var(--color-text-700))]">
            <span className="font-medium text-[rgb(var(--color-text-900))]">Period</span>
            <span>{timeSheet.time_period?.start_date ? parseISO(timeSheet.time_period.start_date).toLocaleDateString() : "N/A"} – {timeSheet.time_period?.end_date ? parseISO(timeSheet.time_period.end_date).toLocaleDateString() : "N/A"}</span>
            <span className="font-medium text-[rgb(var(--color-text-900))]">Submitted</span>
            <span>{formatSubmittedDate(timeSheet.submitted_at)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-[rgb(var(--color-border-100))]">
              <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{formatDuration(totalHours)}</p>
              <p className="text-xs text-[rgb(var(--color-text-600))]">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-[rgb(var(--color-border-100))]">
              <p className="text-2xl font-bold text-[rgb(var(--color-primary-500))]">{formatDuration(totalBillableHours)}</p>
              <p className="text-xs text-[rgb(var(--color-text-600))]">Billable</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-[rgb(var(--color-border-100))]">
              <p className="text-2xl font-bold text-[rgb(var(--color-text-600))]">{formatDuration(totalNonBillableHours)}</p>
              <p className="text-xs text-[rgb(var(--color-text-600))]">Non-Billable</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown by Work Item Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(entriesByType).map(([type, hours]): React.JSX.Element => (
              <div key={type} className="flex items-center justify-between py-1.5 border-b border-[rgb(var(--color-border-200))] last:border-0">
                <span className="text-sm text-[rgb(var(--color-text-700))]">{formatWorkItemType(type)}</span>
                <span className="text-sm font-medium text-[rgb(var(--color-text-900))]">{formatDuration(hours)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(entriesByDate).map(([date, hours]): React.JSX.Element => (
              <div key={date} className="flex items-center justify-between py-1.5 border-b border-[rgb(var(--color-border-200))] last:border-0">
                <span className="text-sm text-[rgb(var(--color-text-700))]">{new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="text-sm font-medium text-[rgb(var(--color-text-900))]">{formatDuration(hours)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle>Detailed Time Entries</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))]">
            <thead>
              <tr className="text-left text-xs font-medium text-[rgb(var(--color-text-600))] uppercase tracking-wider">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Work Item</th>
                <th className="py-2 pr-3">Start</th>
                <th className="py-2 pr-3">End</th>
                <th className="py-2 pr-3">Billable</th>
                <th className="py-2 pr-3 text-center">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--color-border-100))]">
              {entriesWithWorkItems.map((entry): React.JSX.Element => (
                <React.Fragment key={entry.entry_id}>
                  <tr
                    className="cursor-pointer hover:bg-[rgb(var(--color-border-100))] text-sm text-[rgb(var(--color-text-700))]"
                    onClick={() => toggleEntryDetails(entry.entry_id as string)}
                  >
                    <td className="py-2.5 pr-3">{new Date(entry.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    <td className="py-2.5 pr-3">{formatWorkItem(entry.workItem)}</td>
                    <td className="py-2.5 pr-3">{new Date(entry.start_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="py-2.5 pr-3">{new Date(entry.end_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="py-2.5 pr-3 font-medium">{formatDuration(entry.billable_duration / 60)}</td>
                    <td className="py-2.5 pr-3 text-center">
                      <StatusIcon status={entry.approval_status} />
                    </td>
                    <td>
                      <Button
                        id={`toggle-details-${entry.entry_id}`}
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEntryDetails(entry.entry_id as string);
                        }}
                        title={expandedEntryId === entry.entry_id ? "Hide Details" : "Show Details"}
                      >
                        {expandedEntryId === entry.entry_id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                  {expandedEntryId === entry.entry_id && (
                    <tr>
                      <td colSpan={7}>
                        <TimeEntryDetailPanel
                          entry={entry}
                          onUpdateApprovalStatus={handleUpdateApprovalStatus}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className={timeSheet.approval_status === 'CHANGES_REQUESTED' ? 'bg-orange-50' : ''}>
        <CardHeader>
          <CardTitle>
            Comments {timeSheet.approval_status === 'CHANGES_REQUESTED' && 
              <span className="text-sm font-normal text-orange-600">
                (Changes have been requested - please review comments)
              </span>
            }
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {timeSheet.comments?.map((comment): React.JSX.Element => (
              <div 
                key={comment.comment_id} 
                className={`${comment.is_approver ? 'p-3 rounded shadow bg-orange-50 border border-orange-200' : 'p-3 rounded shadow bg-white'} mb-4`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">
                      {comment.is_approver ? 
                        <span className="text-orange-600">
                          {comment.user_name || `${currentUser.first_name} ${currentUser.last_name}`}
                        </span> : 
                        <span>{timeSheet.employee_name}</span>
                      }
                    </p>
                    {comment.is_approver ? (
                      <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        Approver
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        Employee
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{new Date(comment.created_at).toLocaleString()}</p>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{comment.comment}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <TextArea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={timeSheet.approval_status === 'CHANGES_REQUESTED' ? 
                "Add your response to the requested changes..." : 
                "Add a comment..."}
              className={timeSheet.approval_status === 'CHANGES_REQUESTED' ? 
                "border-orange-200 focus:border-orange-500" : ""}
            />
            <Button
              id="add-comment-button"
              onClick={handleAddComment}
              className={`mt-2 ${timeSheet.approval_status === 'CHANGES_REQUESTED' ? 
                'bg-orange-500 hover:bg-orange-600' : ''}`}
              disabled={isAddingComment}
            >
              {isAddingComment ? 'Adding...' : 
                timeSheet.approval_status === 'CHANGES_REQUESTED' ? 
                'Respond to Changes' : 'Add Comment'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-4">
        {timeSheet.approval_status === 'APPROVED' && onReverseApproval ? (
          <Button
            id="timesheet-reverse-approval-btn"
            onClick={onReverseApproval}
            variant="destructive"
          >
            Reverse Approval
          </Button>
        ) : (
          <>
            <Button
              id="timesheet-approve-btn"
              onClick={onApprove}
              variant="default"
              disabled={timeSheet.approval_status === 'APPROVED'}
            >
              Approve
            </Button>
            <Button
              id="timesheet-request-changes-btn"
              onClick={onRequestChanges}
              variant="outline"
              disabled={timeSheet.approval_status === 'APPROVED'}
            >
              Request Changes
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
