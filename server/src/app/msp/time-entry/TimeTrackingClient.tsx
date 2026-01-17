'use client';

import { Profiler } from 'react';
import TimeTracking from '@alga-psa/scheduling/components/time-management/time-entry/TimeTracking';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

interface Props {
  initialUser: IUserWithRoles | null;
  initialIsManager: boolean;
}

export default function TimeTrackingClient({ initialUser, initialIsManager }: Props) {
  if (!initialUser) {
    return <div>No user found</div>;
  }

  const onRender = (
    id: string,
    phase: "mount" | "update" | "nested-update",
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    console.log("Profiler Data:", {
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  };

  return (
    <Profiler id="TimeTrackingPage" onRender={onRender}>
      <TimeTracking currentUser={initialUser} isManager={initialIsManager} />
    </Profiler>
  );
}
