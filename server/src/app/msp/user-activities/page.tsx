import { UserActivitiesDashboard } from '@alga-psa/workflows/components';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User Activities',
};

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect('/auth/msp/signin');
  }

  return <UserActivitiesDashboard />;
}
