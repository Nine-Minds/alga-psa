import { useState, useEffect } from 'react';
import { getTeams } from '@product/actions/team-actions/teamActions';
import { ITeam, IUser } from 'server/src/interfaces';

export function useTeamAuth(currentUser: IUser | null) {
  const [isManager, setIsManager] = useState(false);
  const [managedTeams, setManagedTeams] = useState<ITeam[]>([]);

  useEffect(() => {
    async function checkManagerStatus() {
      if (!currentUser) {
        setIsManager(false);
        setManagedTeams([]);
        return;
      }

      const allTeams = await getTeams();
      const userManagedTeams = allTeams.filter(team => team.manager_id === currentUser.user_id);

      setIsManager(userManagedTeams.length > 0);
      setManagedTeams(userManagedTeams);
    }

    checkManagerStatus();
  }, [currentUser]);

  return { isManager, managedTeams };
}