'use client';

import { useEffect, useState } from 'react';
import { getTeams } from '@alga-psa/teams/actions';
import type { ITeam, IUser } from '@alga-psa/types';

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

      try {
        const allTeams = await getTeams();
        const userManagedTeams = allTeams.filter((team) => team.manager_id === currentUser.user_id);

        setIsManager(userManagedTeams.length > 0);
        setManagedTeams(userManagedTeams);
      } catch (error) {
        console.warn('[useTeamAuth] Failed to load teams for manager check; defaulting to non-manager', error);
        setIsManager(false);
        setManagedTeams([]);
      }
    }

    void checkManagerStatus();
  }, [currentUser]);

  return { isManager, managedTeams };
}

