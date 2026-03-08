import { getCurrentUser } from "@alga-psa/user-composition/actions";
import { getTeams } from '@alga-psa/teams/actions';
import TimeTrackingClient from '@alga-psa/scheduling/components/time-management/time-entry/TimeTrackingClient';


export const metadata = {
  title: 'Time Entry',
};

export default async function TimeTrackingPage() {
  const currentUser = await getCurrentUser();
  const teamsData = currentUser ? await getTeams() : [];
  const isManager = teamsData.some(team => team.manager_id === currentUser?.user_id);

  return <TimeTrackingClient initialUser={currentUser} initialIsManager={isManager} />;
}

export const dynamic = "force-dynamic";
