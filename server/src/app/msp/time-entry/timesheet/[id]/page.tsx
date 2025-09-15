import { notFound } from 'next/navigation';
import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';
import { fetchTimeSheet } from 'server/src/lib/actions/timeSheetActions';
import TimeSheetClient from './TimeSheetClient';

export default async function TimeSheetPage({ params }: any) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return notFound();
  }

  const teamsData = await getTeams();
  const isManager = teamsData.some(team => team.manager_id === currentUser?.user_id);

  try {
    const timeSheet = await fetchTimeSheet(params.id);
    
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
