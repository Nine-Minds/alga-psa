'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getCurrentTimePeriod } from '../actions/timePeriodsActions';
import { fetchOrCreateTimeSheet, saveTimeEntry, getTimeEntryById } from '../actions/timeEntryActions';
import type { IExtendedWorkItem, ITimeEntryWithWorkItem, TimeEntryWorkItemContext } from '@alga-psa/types';
import TimeEntryDialog from '../components/time-management/time-entry/time-sheet/TimeEntryDialog';
import type { OpenDrawerFn } from '@alga-psa/ui/context';

interface LaunchTimeEntryParams {
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  context: TimeEntryWorkItemContext;
  onComplete?: () => void;
  existingEntryId?: string;
  // release-v1.5-feature launch feedback. Absent/false reproduces the legacy
  // toast behavior exactly (plain toast, legacy copy); true switches to the
  // deduplicated long-lived blocked toast with the refreshed copy.
  enhancedLaunchFeedback?: boolean;
}

// Precondition failures happen before any dialog opens, so this toast is the only
// feedback the user gets. Keep it on screen long enough to read, and reuse one id
// so repeated clicks refresh the message instead of looking like a dead button.
const launchBlockedToastV15 = (message: string) => {
  toast.error(message, { id: 'time-entry-launch-blocked', duration: 10000 });
};

const NO_TIME_PERIOD_MESSAGE_LEGACY = 'No active time period found. Please configure time periods before entering time.';
const NO_TIME_PERIOD_MESSAGE_V15 = 'No time period covers today, so time can’t be entered yet. Ask an administrator to create time periods under Settings → Time Entry.';

const buildWorkItem = (context: TimeEntryWorkItemContext): Omit<IExtendedWorkItem, 'tenant'> => {
  return {
    work_item_id: context.workItemId,
    type: context.workItemType,
    name: context.workItemName,
    description: context.timeDescription || '',
    ticket_number: context.ticketNumber,
    master_ticket_id: context.masterTicketId,
    master_ticket_number: context.masterTicketNumber,
    interaction_type: context.interactionType,
    client_name: context.clientName ?? undefined,
    startTime: context.startTime,
    endTime: context.endTime,
    project_name: context.projectName,
    phase_name: context.phaseName,
    task_name: context.taskName,
    service_id: context.serviceId,
    service_name: context.serviceName,
  };
};

const deriveDefaultTimes = (context: TimeEntryWorkItemContext) => {
  if (context.startTime || context.endTime) {
    return {
      defaultStartTime: context.startTime,
      defaultEndTime: context.endTime,
    };
  }

  if (context.elapsedTime && context.elapsedTime > 0) {
    const defaultEndTime = new Date();
    const defaultStartTime = new Date(defaultEndTime.getTime() - context.elapsedTime * 1000);
    return { defaultStartTime, defaultEndTime };
  }

  return { defaultStartTime: undefined, defaultEndTime: undefined };
};

export async function launchTimeEntryForWorkItem({ openDrawer, closeDrawer, context, onComplete, existingEntryId, enhancedLaunchFeedback }: LaunchTimeEntryParams): Promise<void> {
  // release-v1.5-feature gate: flag off keeps the exact legacy toast surface
  // (plain toast.error, legacy copy); flag on gets the deduplicated long-lived
  // blocked toast with the refreshed copy.
  const launchBlockedToast = (message: string) => {
    if (enhancedLaunchFeedback) {
      launchBlockedToastV15(message);
    } else {
      toast.error(message);
    }
  };

  try {
    const user = await getCurrentUser();
    if (!user?.user_id) {
      launchBlockedToast('Unable to load current user for time entry.');
      return;
    }

    let existingEntry: ITimeEntryWithWorkItem | null = null;
    if (existingEntryId) {
      existingEntry = await getTimeEntryById(existingEntryId);
      if (isActionMessageError(existingEntry) || isActionPermissionError(existingEntry)) {
        launchBlockedToast(getErrorMessage(existingEntry));
        return;
      }
      if (!existingEntry) {
        launchBlockedToast('Time entry not found.');
        return;
      }
    }

    const currentTimePeriod = await getCurrentTimePeriod();
    if (isActionMessageError(currentTimePeriod) || isActionPermissionError(currentTimePeriod)) {
      launchBlockedToast(getErrorMessage(currentTimePeriod));
      return;
    }
    if (!currentTimePeriod) {
      launchBlockedToast(enhancedLaunchFeedback ? NO_TIME_PERIOD_MESSAGE_V15 : NO_TIME_PERIOD_MESSAGE_LEGACY);
      return;
    }

    let timeSheetId = existingEntry?.time_sheet_id;
    if (!timeSheetId) {
      const timeSheet = await fetchOrCreateTimeSheet(user.user_id, currentTimePeriod.period_id);
      if (isActionMessageError(timeSheet) || isActionPermissionError(timeSheet)) {
        launchBlockedToast(getErrorMessage(timeSheet));
        return;
      }
      timeSheetId = timeSheet.id;
    }

    const workItem = buildWorkItem(context);
    const { defaultStartTime, defaultEndTime } = deriveDefaultTimes(context);
    const baseDate = existingEntry?.start_time
      ? new Date(existingEntry.start_time)
      : context.startTime || defaultStartTime || new Date();

    openDrawer(
      <TimeEntryDialog
        isOpen={true}
        onClose={closeDrawer}
        onSave={async (timeEntry) => {
          try {
            const savedEntry = await saveTimeEntry(timeEntry);
            if (isActionMessageError(savedEntry) || isActionPermissionError(savedEntry)) {
              toast.error(getErrorMessage(savedEntry));
              return;
            }
            closeDrawer();
            if (onComplete) onComplete();
          } catch (error) {
            console.error('Failed to save time entry:', error);
            toast.error(getErrorMessage(error));
          }
        }}
        workItem={workItem}
        date={baseDate}
        existingEntries={existingEntry ? [existingEntry] : undefined}
        timePeriod={currentTimePeriod}
        isEditable={true}
        defaultStartTime={defaultStartTime}
        defaultEndTime={defaultEndTime}
        timeSheetId={timeSheetId}
        inDrawer={true}
      />,
      undefined,
      undefined,
      '900px'
    );
  } catch (error) {
    console.error('Failed to launch time entry dialog:', error);
    toast.error('An error occurred while preparing the time entry. Please try again.');
  }
}
