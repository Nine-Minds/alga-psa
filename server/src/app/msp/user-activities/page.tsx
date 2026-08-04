import { UserActivitiesDashboard } from '@alga-psa/msp-composition/user-activities';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import OpportunitySnapshotCard from '@/components/dashboard/OpportunitySnapshotCard';

export const metadata: Metadata = {
  title: 'User Activities',
};

export default async function UserActivitiesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/msp/signin');
  }

  // The pipeline snapshot belongs with the rest of a user's own work, not on
  // the home page every technician lands on.
  return (
    <>
      <div className="container mx-auto px-6 pt-6">
        <OpportunitySnapshotCard />
      </div>
      <UserActivitiesDashboard />
    </>
  );
}
