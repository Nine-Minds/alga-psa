import { notFound } from 'next/navigation';
import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';
import { fetchTimeSheet } from '@alga-psa/scheduling/actions/timeSheetActions';
import TimeSheetClient from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeSheetClient';

export default async function TimeSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return notFound();
  }

  const teamsData = await getTeams();
  const isManager = teamsData.some(team => team.manager_id === currentUser?.user_id);

  try {
    const timeSheet = await fetchTimeSheet(id);
    
    // Verify the user has access to this timesheet
    if (timeSheet.user_id !== currentUser.user_id && !isManager) {
      return notFound();
    }

    return (
      <TimeSheetClient 
        timeSheet={timeSheet}
        currentUser={currentUser}
        isManager={isManager}
      />
    );
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    return notFound();
  }
}

export const dynamic = "force-dynamic";
