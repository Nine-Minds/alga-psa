'use client'

import { useState, useEffect } from 'react';
import { ITimeSheet, ITimeSheetApproval, ITimeSheetWithUserInfo } from '@/interfaces/timeEntry.interfaces';
import { Button } from '../ui/Button';
import { fetchTimeSheetsForApproval, bulkApproveTimeSheets, fetchTimeEntriesForTimeSheet, approveTimeSheet, requestChangesForTimeSheet, fetchTimeSheetComments } from '@/lib/actions/timeSheetActions';
import { useTeamAuth } from '@/hooks/useTeamAuth';
import { IUser } from '@/interfaces';
import { TimeSheetApproval } from './TimeSheetApproval';
import { useDrawer } from '@/context/DrawerContext'; // Assuming you're using a drawer for the approval view
import { parseISO } from 'date-fns';

interface ManagerApprovalDashboardProps {
  currentUser: IUser;
}

export default function ManagerApprovalDashboard({ currentUser }: ManagerApprovalDashboardProps) {
  const [timeSheets, setTimeSheets] = useState<ITimeSheetApproval[]>([]);
  const [selectedTimeSheets, setSelectedTimeSheets] = useState<string[]>([]);
  const { isManager, managedTeams } = useTeamAuth(currentUser);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    if (isManager) {
      loadTimeSheets();
    }
  }, [isManager]);

  const loadTimeSheets = async () => {
    const sheets = await fetchTimeSheetsForApproval(managedTeams.map((team):string => team.team_id));
    setTimeSheets(sheets);
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

  const handleViewTimeSheet = async (timeSheet: ITimeSheetApproval) => {
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
            loadTimeSheets();
          }}
          onRequestChanges={async () => {
            await requestChangesForTimeSheet(timeSheet.id, currentUser.user_id);
            loadTimeSheets();
          }}
        />
      );
    } catch (error) {
      console.error('Error fetching time sheet details:', error);
    }
  };


  if (!isManager) {
    return <div>You do not have permission to view this page.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Time Sheet Approvals</h1>
      <div className="mb-4">
        <Button
          id="bulk-approve-btn"
          onClick={handleBulkApprove}
          disabled={selectedTimeSheets.length === 0}
        >
          Bulk Approve Selected
        </Button>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Select
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Employee
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Period
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {timeSheets.map((sheet):JSX.Element => (
            <tr key={sheet.id} className={sheet.approval_status === 'CHANGES_REQUESTED' ? 'bg-orange-100' : ''}>

              <td className="px-6 py-4 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={selectedTimeSheets.includes(sheet.id)}
                  onChange={() => handleSelectTimeSheet(sheet.id)}
                  disabled={sheet.approval_status === 'CHANGES_REQUESTED'}
                />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">{sheet.employee_name}</td>
              <td className="px-6 py-4 whitespace-nowrap">
              {(sheet.time_period?.start_date) ? parseISO(sheet.time_period?.start_date).toLocaleDateString() : 'N/A'} - {(sheet.time_period?.end_date) ? parseISO(sheet.time_period?.end_date).toLocaleDateString() : 'N/A'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${sheet.approval_status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                  }`}>
                  {sheet.approval_status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <Button id={`view-timesheet-${sheet.id}-btn`} onClick={() => handleViewTimeSheet(sheet)}>View</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
