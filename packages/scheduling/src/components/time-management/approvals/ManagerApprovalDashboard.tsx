'use client'

import { useState, useEffect } from 'react';
import { ITimeSheet, ITimeSheetApproval, ITimeSheetApprovalView, ITimeSheetWithUserInfo } from 'server/src/interfaces/timeEntry.interfaces';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Users } from 'lucide-react';
import {
  fetchTimeSheetsForApproval,
  bulkApproveTimeSheets,
  fetchTimeEntriesForTimeSheet,
  approveTimeSheet,
  requestChangesForTimeSheet,
  fetchTimeSheetComments,
  reverseTimeSheetApproval
} from '../../../actions/timeSheetActions';
import { useTeamAuth } from 'server/src/hooks/useTeamAuth';
import { IUser } from 'server/src/interfaces';
import { TimeSheetApproval } from './TimeSheetApproval';
import { useDrawer } from "server/src/context/DrawerContext";
import { parseISO } from 'date-fns';

interface ManagerApprovalDashboardProps {
  currentUser: IUser;
}

export default function ManagerApprovalDashboard({ currentUser }: ManagerApprovalDashboardProps) {
  const [timeSheets, setTimeSheets] = useState<ITimeSheetApprovalView[]>([]);
  const [selectedTimeSheets, setSelectedTimeSheets] = useState<string[]>([]);
  const [showApproved, setShowApproved] = useState(false);
  const [reverseConfirmOpen, setReverseConfirmOpen] = useState(false);
  const [timeSheetToReverse, setTimeSheetToReverse] = useState<ITimeSheetApprovalView | null>(null);
  const { isManager, managedTeams } = useTeamAuth(currentUser);
  const { openDrawer, closeDrawer } = useDrawer();

  useEffect(() => {
    if (isManager) {
      loadTimeSheets();
    }
  }, [isManager, showApproved]);

  const loadTimeSheets = async () => {
    const sheets = await fetchTimeSheetsForApproval(
      managedTeams.map((team):string => team.team_id),
      showApproved
    );
    setTimeSheets(sheets);
  };

  const handleReverseApproval = (timeSheet: ITimeSheetApprovalView) => {
    setTimeSheetToReverse(timeSheet);
    setReverseConfirmOpen(true);
  };

  const confirmReverseApproval = async () => {
    if (!timeSheetToReverse) return;

    try {
      await reverseTimeSheetApproval(
        timeSheetToReverse.id,
        currentUser.user_id,
        'Approval reversed by manager'
      );
      await loadTimeSheets();
      setReverseConfirmOpen(false);
      setTimeSheetToReverse(null);
      closeDrawer();
    } catch (error) {
      console.error('Failed to reverse approval:', error);
      alert('Failed to reverse approval: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleSelectTimeSheet = (id: string) => {
    setSelectedTimeSheets(prev =>
      prev.includes(id) ? prev.filter(sheetId => sheetId !== id) : [...prev, id]
    );
  };

  const handleBulkApprove = async () => {
    await bulkApproveTimeSheets(selectedTimeSheets, currentUser.user_id);
    loadTimeSheets();
    setSelectedTimeSheets([]);
  };

  const handleViewTimeSheet = async (timeSheet: ITimeSheetApprovalView) => {
    try {
      const [timeEntries, comments] = await Promise.all([
        fetchTimeEntriesForTimeSheet(timeSheet.id),
        fetchTimeSheetComments(timeSheet.id)
      ]);

      const timeSheetWithComments = {
        ...timeSheet,
        comments
      };

      openDrawer(
        <TimeSheetApproval
          currentUser={currentUser}
          timeSheet={timeSheetWithComments}
          timeEntries={timeEntries}
          onApprove={async () => {
           await approveTimeSheet(timeSheet.id, currentUser.user_id);
           await loadTimeSheets();
           closeDrawer();
          }}
          onRequestChanges={async () => {
           await requestChangesForTimeSheet(timeSheet.id, currentUser.user_id);
           await loadTimeSheets();
           closeDrawer();
          }}
          onReverseApproval={() => handleReverseApproval(timeSheet)}
        />
      );
    } catch (error) {
      console.error('Error fetching time sheet details:', error);
    }
  };


  if (!isManager) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Card className="max-w-xl w-full p-6">
          <CardHeader className="flex flex-row items-center gap-3 p-0 mb-4">
            <Users className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            <CardTitle className="text-xl">Team lead access required</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-[rgb(var(--color-text-700))] mb-4">
              To approve time sheets for your team members, you need to be a team lead.
            </p>
            <Button id="go-to-team-settings" asChild>
              <Link href="/msp/settings?tab=teams">Go to Team Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Time Sheet Approvals</h1>
        <div className="flex gap-4">
          <Button
            id="toggle-approved-btn"
            onClick={() => setShowApproved(!showApproved)}
            variant="outline"
          >
            {showApproved ? 'Hide Approved' : 'Show Approved'}
          </Button>
          <Button
            id="bulk-approve-btn"
            onClick={handleBulkApprove}
            disabled={selectedTimeSheets.length === 0}
          >
            Bulk Approve Selected
          </Button>
        </div>
      </div>
      <DataTable
        id="manager-approval-timesheets"
        data={timeSheets}
        columns={[
          {
            title: 'Select',
            dataIndex: 'select',
            width: '10%',
            sortable: false, // Non-data column, sorting disabled
            render: (_, record) => (
              <div className="[&>div]:mb-0" onClick={(e) => e.stopPropagation()}>
                {/* Unique ID for UI reflection system */}
                <Checkbox
                  id={`timesheet-select-${record.id}`}
                  checked={selectedTimeSheets.includes(record.id)}
                  onChange={() => handleSelectTimeSheet(record.id)}
                  disabled={
                    record.approval_status === 'CHANGES_REQUESTED' ||
                    record.approval_status === 'APPROVED'
                  }
                />
              </div>
            )
          },
          {
            title: 'Employee',
            dataIndex: 'employee_name',
            width: '20%'
          },
          {
            title: 'Period',
            // Use dot notation to access nested start_date for proper date sorting.
            // DataTable's getNestedValue() handles dot notation, and caseInsensitiveSort()
            // parses ISO-8601 date strings for accurate chronological sorting.
            // The render function displays both start and end dates from the full record.
            dataIndex: 'time_period.start_date',
            width: '25%',
            render: (_, record) => (
              <>
                {record.time_period?.start_date ? parseISO(record.time_period.start_date).toLocaleDateString() : 'N/A'} -{' '}
                {record.time_period?.end_date ? parseISO(record.time_period.end_date).toLocaleDateString() : 'N/A'}
              </>
            )
          },
          {
            title: 'Status',
            dataIndex: 'approval_status',
            width: '20%',
            render: (status) => (
              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                status === 'APPROVED'
                  ? 'bg-green-100 text-green-800'
                  : status === 'SUBMITTED'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {status}
              </span>
            )
          },
          {
            title: 'Actions',
            dataIndex: 'actions',
            width: '15%',
            sortable: false, // Non-data column, sorting disabled
            render: (_, record) => (
              <div className="flex gap-2">
                {/* Unique IDs for UI reflection system */}
                <Button
                  id={`view-timesheet-${record.id}-btn`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewTimeSheet(record);
                  }}
                  variant="soft"
                >
                  View
                </Button>
                {record.approval_status === 'APPROVED' && (
                  <Button
                    id={`reverse-approval-${record.id}-btn`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReverseApproval(record);
                    }}
                    variant="destructive"
                  >
                    Reverse
                  </Button>
                )}
              </div>
            )
          }
        ]}
        onRowClick={(row: ITimeSheetApprovalView) => handleViewTimeSheet(row)}
        rowClassName={(row: ITimeSheetApprovalView) => 
          row.approval_status === 'APPROVED'
            ? 'bg-green-50'
            : row.approval_status === 'CHANGES_REQUESTED'
              ? 'bg-orange-100'
              : ''
        }
        pagination={false}
      />

      <ConfirmationDialog
        id="reverse-approval-confirmation"
        isOpen={reverseConfirmOpen}
        onClose={() => {
          setReverseConfirmOpen(false);
          setTimeSheetToReverse(null);
        }}
        onConfirm={confirmReverseApproval}
        title="Reverse Approval"
        message={`Are you sure you want to reverse the approval of this time sheet${timeSheetToReverse?.employee_name ? ` for ${timeSheetToReverse.employee_name}` : ''}?`}
        confirmLabel="Reverse Approval"
        cancelLabel="Cancel"
      />
    </div>
  );
}
