// src/components/TimeTracking.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { TimePeriodList } from './TimePeriodList';
import { SkeletonTimeSheet } from './SkeletonTimeSheet';
import { ITimePeriodWithStatusView } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { fetchTimePeriods, fetchOrCreateTimeSheet, deleteTimeSheets } from '../../../actions/timeEntryActions';
import { deleteTimePeriods } from '../../../actions/timePeriodsActions';
import { fetchEligibleTimeEntrySubjects } from '../../../actions/timeEntryDelegationActions';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';


interface TimeTrackingProps {
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeTracking({ currentUser, isManager }: TimeTrackingProps) {
  const { t } = useTranslation('msp/time-entry');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { enabled: delegatedTimeEntryEnabled, loading: delegatedTimeEntryLoading } = useFeatureFlag(
    'delegated-time-entry',
    { defaultValue: false }
  );
  const isDelegatedTimeEntryUIEnabled = delegatedTimeEntryEnabled && !delegatedTimeEntryLoading;
  const requestedSubjectUserId = searchParams?.get('subjectUserId');

  const [subjectUsers, setSubjectUsers] = useState<IUser[]>([]);
  const [subjectUserId, setSubjectUserId] = useState(requestedSubjectUserId ?? currentUser.user_id);
  const [timePeriods, setTimePeriods] = useState<ITimePeriodWithStatusView[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const syncSubjectUserIdToUrl = useCallback((nextSubjectUserId: string) => {
    if (!pathname) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString());
    if (nextSubjectUserId !== currentUser.user_id) {
      params.set('subjectUserId', nextSubjectUserId);
    } else {
      params.delete('subjectUserId');
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [currentUser.user_id, pathname, router, searchParams]);

  useEffect(() => {
    if (!isDelegatedTimeEntryUIEnabled) {
      setSubjectUsers([currentUser]);
      if (subjectUserId !== currentUser.user_id) {
        setSubjectUserId(currentUser.user_id);
      }
      if (requestedSubjectUserId) {
        syncSubjectUserIdToUrl(currentUser.user_id);
      }
      return;
    }

    let cancelled = false;

    const loadEligibleSubjects = async () => {
      const users = await fetchEligibleTimeEntrySubjects();
      if (cancelled) {
        return;
      }

      setSubjectUsers(users);

      const nextSubjectUserId = users.some((u) => u.user_id === requestedSubjectUserId)
        ? requestedSubjectUserId!
        : currentUser.user_id;

      setSubjectUserId((currentSelection) =>
        currentSelection === nextSubjectUserId ? currentSelection : nextSubjectUserId
      );

      const normalizedRequestedSubjectUserId =
        nextSubjectUserId === currentUser.user_id ? null : nextSubjectUserId;

      if (requestedSubjectUserId !== normalizedRequestedSubjectUserId) {
        syncSubjectUserIdToUrl(nextSubjectUserId);
      }
    };

    void loadEligibleSubjects();

    return () => {
      cancelled = true;
    };
  }, [currentUser, isDelegatedTimeEntryUIEnabled, requestedSubjectUserId, subjectUserId, syncSubjectUserIdToUrl]);

  useEffect(() => {
    setTimePeriods([]);
    setIsLoading(true);
    void loadTimePeriods();
  }, [subjectUserId]);

  const loadTimePeriods = async () => {
    try {
      const periods = await fetchTimePeriods(subjectUserId);
      if (isActionMessageError(periods) || isActionPermissionError(periods)) {
        toast.error(getErrorMessage(periods));
        setTimePeriods([]);
        return;
      }
      setTimePeriods(periods);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTimeSheets = async (timeSheetIds: string[]) => {
    try {
      const result = await deleteTimeSheets(timeSheetIds);

      if (result.deletedIds.length > 0) {
        toast.success(t('timePeriodList.delete.success', {
          defaultValue: '{{count}} time sheet(s) removed',
          count: result.deletedIds.length,
        }));
      }

      if (result.failed.length > 0) {
        toast.error(t('timePeriodList.delete.partialFailure', {
          defaultValue: "{{count}} time sheet(s) couldn't be removed",
          count: result.failed.length,
        }));
      }
    } catch (error) {
      console.error('Error removing time sheets:', error);
      toast.error(t('timePeriodList.delete.error', { defaultValue: 'Failed to remove time sheet(s)' }));
    } finally {
      await loadTimePeriods();
    }
  };

  const handleDeletePeriods = async (periodIds: string[]) => {
    try {
      const result = await deleteTimePeriods(periodIds);

      if (result.deletedIds.length > 0) {
        toast.success(t('timePeriodList.removePeriod.success', {
          defaultValue: '{{count}} time period(s) removed',
          count: result.deletedIds.length,
        }));
      }

      if (result.failed.length > 0) {
        toast.error(t('timePeriodList.removePeriod.partialFailure', {
          defaultValue: "{{count}} time period(s) couldn't be removed",
          count: result.failed.length,
        }));
      }
    } catch (error) {
      console.error('Error removing time periods:', error);
      toast.error(t('timePeriodList.removePeriod.error', { defaultValue: 'Failed to remove time period(s)' }));
    } finally {
      await loadTimePeriods();
    }
  };

  const handleSelectTimePeriod = async (timePeriod: ITimePeriodWithStatusView) => {
    try {
      const timeSheet = await fetchOrCreateTimeSheet(subjectUserId, timePeriod.period_id);
      if (isActionMessageError(timeSheet) || isActionPermissionError(timeSheet)) {
        toast.error(getErrorMessage(timeSheet));
        return;
      }
      const params = new URLSearchParams();
      if (subjectUserId !== currentUser.user_id) {
        params.set('subjectUserId', subjectUserId);
      }

      const nextQuery = params.toString();
      const nextUrl = nextQuery
        ? `/msp/time-entry/timesheet/${timeSheet.id}?${nextQuery}`
        : `/msp/time-entry/timesheet/${timeSheet.id}`;

      router.push(nextUrl);
    } catch (error) {
      console.error('Error creating/fetching timesheet:', error);
    }
  };

  const handleSubjectUserChange = (nextSubjectUserId: string) => {
    setSubjectUserId(nextSubjectUserId);
    syncSubjectUserIdToUrl(nextSubjectUserId);
  };

  if (isLoading) {
    return <SkeletonTimeSheet />;
  }

  const showSubjectSelector = isDelegatedTimeEntryUIEnabled && subjectUsers.length > 1;

  return (
    <div className="space-y-4">
      {showSubjectSelector && (
        <div className="w-full max-w-md">
          <UserPicker
            label={t('timeTracking.subjectUserLabel', { defaultValue: 'User' })}
            value={subjectUserId}
            onValueChange={handleSubjectUserChange}
            users={subjectUsers}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            buttonWidth="full"
          />
        </div>
      )}

      <TimePeriodList
        timePeriods={timePeriods}
        onSelectTimePeriod={handleSelectTimePeriod}
        onDeleteTimeSheets={handleDeleteTimeSheets}
        onDeletePeriods={handleDeletePeriods}
        canManagePeriods={isManager}
      />
    </div>
  );
}
