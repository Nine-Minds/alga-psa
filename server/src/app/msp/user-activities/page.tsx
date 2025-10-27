import { UserActivitiesDashboard } from 'server/src/components/user-activities/UserActivitiesDashboard';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { redirect } from 'next/navigation';

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect('/auth/msp/signin');
  }

  return <UserActivitiesDashboard />;
}