// src/components/TimeTracking.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TimePeriodList } from './TimePeriodList';
import { SkeletonTimeSheet } from './SkeletonTimeSheet';
import { ITimePeriodWithStatusView } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { fetchTimePeriods, fetchOrCreateTimeSheet } from '../../../actions/timeEntryActions';
import { fetchEligibleTimeEntrySubjects } from '../../../actions/timeEntryDelegationActions';


interface TimeTrackingProps {
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeTracking({ currentUser, isManager: _isManager }: TimeTrackingProps) {
  const router = useRouter();
  const [subjectUsers, setSubjectUsers] = useState<IUser[]>([]);
  const [subjectUserId, setSubjectUserId] = useState(currentUser.user_id);
  const [timePeriods, setTimePeriods] = useState<ITimePeriodWithStatusView[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadEligibleSubjects();
  }, [currentUser.user_id]);

  useEffect(() => {
    setIsLoading(true);
    void loadTimePeriods();
  }, [subjectUserId]);

  const loadEligibleSubjects = async () => {
    const users = await fetchEligibleTimeEntrySubjects();
    setSubjectUsers(users);

    if (!users.some((u) => u.user_id === subjectUserId)) {
      setSubjectUserId(currentUser.user_id);
    }
  };

  const loadTimePeriods = async () => {
    try {
      const periods = await fetchTimePeriods(subjectUserId);
      setTimePeriods(periods);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectTimePeriod = async (timePeriod: ITimePeriodWithStatusView) => {
    try {
      const timeSheet = await fetchOrCreateTimeSheet(subjectUserId, timePeriod.period_id);
      // Navigate to the timesheet page with its ID
      router.push(`/msp/time-entry/timesheet/${timeSheet.id}`);
    } catch (error) {
      console.error('Error creating/fetching timesheet:', error);
    }
  };

  if (isLoading) {
    return <SkeletonTimeSheet />;
  }

  const showSubjectSelector = subjectUsers.length > 1;

  return (
    <div className="space-y-4">
      {showSubjectSelector && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">User</label>
          <select
            className="w-full max-w-md rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            value={subjectUserId}
            onChange={(e) => setSubjectUserId(e.target.value)}
          >
            {subjectUsers.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {`${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <TimePeriodList timePeriods={timePeriods} onSelectTimePeriod={handleSelectTimePeriod} />
    </div>
  );
}
