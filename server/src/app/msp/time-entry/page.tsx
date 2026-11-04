import { getCurrentUser } from "@alga-psa/user-composition/actions";
import { resolveIsManager } from './resolveIsManager';
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
  const isManager = await resolveIsManager(currentUser?.user_id);

  return <TimeTrackingClient initialUser={currentUser} initialIsManager={isManager} />;
}

export const dynamic = "force-dynamic";
