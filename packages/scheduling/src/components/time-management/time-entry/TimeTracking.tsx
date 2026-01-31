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
import UserPicker from '@alga-psa/ui/components/UserPicker';


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
    setTimePeriods([]);
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
        <div className="w-full max-w-md">
          <UserPicker
            label="User"
            value={subjectUserId}
            onValueChange={setSubjectUserId}
            users={subjectUsers}
            buttonWidth="full"
          />
        </div>
      )}

      <TimePeriodList timePeriods={timePeriods} onSelectTimePeriod={handleSelectTimePeriod} />
    </div>
  );
}
