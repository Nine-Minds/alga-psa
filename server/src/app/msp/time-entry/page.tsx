import { getCurrentUser } from "@alga-psa/user-composition/actions";
import { getTeams, isTeamActionError } from '@alga-psa/teams/actions';
import TimeTrackingClient from '@alga-psa/scheduling/components/time-management/time-entry/TimeTrackingClient';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.timeEntry.title', { defaultValue: 'Time Entry' }),
  };
}

export default async function TimeTrackingPage() {
  const currentUser = await getCurrentUser();

  let isManager = false;
  if (currentUser) {
    try {
      const teamsData = await getTeams();
      if (isTeamActionError(teamsData)) {
        console.warn('[TimeTrackingPage] Cannot load teams for manager check; defaulting to non-manager', teamsData);
        return;
      }
      isManager = teamsData.some(team => team.manager_id === currentUser.user_id);
    } catch (error) {
      console.warn('[TimeTrackingPage] Failed to load teams for manager check; defaulting to non-manager', error);
    }
  }

  return <TimeTrackingClient initialUser={currentUser} initialIsManager={isManager} />;
}

export const dynamic = "force-dynamic";
