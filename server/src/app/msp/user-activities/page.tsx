import { UserActivitiesDashboard } from '@alga-psa/ui/components/user-activities/UserActivitiesDashboard';
import { getCurrentUser } from '@alga-psa/users/actions';
import { redirect } from 'next/navigation';

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect('/auth/msp/signin');
  }

  return <UserActivitiesDashboard />;
}
