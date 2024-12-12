// src/app/msp/time-entry/page.tsx
'use client';

import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import TimeTracking from '@/components/time-management/TimeTracking';
import { redirect } from 'next/navigation';
import { findUserById } from '@/lib/actions/user-actions/userActions';
import { getTeams } from '@/lib/actions/team-actions/teamActions';
import { Profiler, useState, useEffect } from 'react';
import { getCurrentUser } from "@/lib/actions/user-actions/userActions";
import { IUserWithRoles } from '@/interfaces/auth.interfaces';

const TimeTrackingPage = () => {
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          throw new Error("User not found");
        }
        setUser(currentUser);

        const teamsData = await getTeams();
        setIsManager(teamsData.some(team => team.manager_id === currentUser.user_id));
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  const onRender = (
    id: string,
    phase: "mount" | "update" | "nested-update",
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    // Aggregate or log render information
    console.log("Profiler Data:", {
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  };

  if (!user) {
    return <div>No user found</div>;
  }

  return (
    <Profiler id="TimeTrackingPage" onRender={onRender}>
      <TimeTracking currentUser={user} isManager={isManager} />
    </Profiler>
  );
}

export default TimeTrackingPage;
