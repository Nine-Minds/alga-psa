import { UserActivitiesDashboard } from '@alga-psa/ui/components/user-activities/UserActivitiesDashboard';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { redirect } from 'next/navigation';

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect('/auth/msp/signin');
  }

  return <UserActivitiesDashboard />;
}
