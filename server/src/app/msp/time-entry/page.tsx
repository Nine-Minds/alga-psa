import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';
import TimeTrackingClient from './TimeTrackingClient';

export default async function TimeTrackingPage() {
  const currentUser = await getCurrentUser();
  const teamsData = currentUser ? await getTeams() : [];
  const isManager = teamsData.some(team => team.manager_id === currentUser?.user_id);

  return <TimeTrackingClient initialUser={currentUser} initialIsManager={isManager} />;
}

export const dynamic = "force-dynamic";
