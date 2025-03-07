"use client";

import { UserActivitiesDashboard } from 'server/src/components/user-activities/UserActivitiesDashboard';
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
          redirect('/auth/signin');
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
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!user) {
    return null; // This will be handled by the redirect in the useEffect
  }

  return <UserActivitiesDashboard />;
}