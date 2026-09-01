import { UserActivitiesDashboard } from '@alga-psa/msp-composition/user-activities';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.userActivities.title', { defaultValue: 'User Activities' }),
  };
}

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/msp/signin');
  }

  return <UserActivitiesDashboard />;
}
