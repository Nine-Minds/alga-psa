"use client";

import { UserActivitiesDashboard } from 'server/src/components/user-activities/UserActivitiesDashboard';
import Spinner from 'server/src/components/ui/Spinner';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { useEffect, useState } from 'react';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { redirect } from 'next/navigation';

export default function UserActivitiesPage() {
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const userData = await getCurrentUser();
        if (!userData) {
          redirect('/auth/msp/signin');
        }
        setUser(userData);
      } catch (error) {
        console.error('Error loading user:', error);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  if (loading) {
    return (
      <Spinner size="lg" className="h-screen" />
    );
  }

  if (!user) {
    return null; // This will be handled by the redirect in the useEffect
  }

  return <UserActivitiesDashboard />;
}