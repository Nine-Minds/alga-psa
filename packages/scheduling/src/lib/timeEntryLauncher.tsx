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
}

// Precondition failures happen before any dialog opens, so this toast is the only
// feedback the user gets. Keep it on screen long enough to read, and reuse one id
// so repeated clicks refresh the message instead of looking like a dead button.
const launchBlockedToast = (message: string) => {
  toast.error(message, { id: 'time-entry-launch-blocked', duration: 10000 });
};

const NO_TIME_PERIOD_MESSAGE = 'No time period covers today, so time can’t be entered yet. Ask an administrator to create time periods under Settings → Time Entry.';

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

// Preparation is shared by drawer launchers and resource-scoped dialogs.
export async function prepareTimeEntryForWorkItem(context: TimeEntryWorkItemContext, existingEntryId?: string) {
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
      launchBlockedToast(NO_TIME_PERIOD_MESSAGE);
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

    return { workItem, date: baseDate, existingEntries: existingEntry ? [existingEntry] : undefined,
      timePeriod: currentTimePeriod, defaultStartTime, defaultEndTime, timeSheetId };

  } catch (error) {
    console.error('Failed to launch time entry dialog:', error);
    toast.error('An error occurred while preparing the time entry. Please try again.');
  }
}

export { TimeEntryDialog };

export async function launchTimeEntryForWorkItem({ openDrawer, closeDrawer, context, onComplete, existingEntryId }: LaunchTimeEntryParams): Promise<void> {
  const prepared = await prepareTimeEntryForWorkItem(context, existingEntryId);
  if (!prepared) return;
  openDrawer(
    <TimeEntryDialog {...prepared} isOpen={true} onClose={closeDrawer} isEditable={true} inDrawer={true}
      onSave={async timeEntry => {
        const savedEntry = await saveTimeEntry(timeEntry);
        if (isActionMessageError(savedEntry) || isActionPermissionError(savedEntry)) throw new Error(getErrorMessage(savedEntry));
        closeDrawer(); onComplete?.();
      }} />,
    undefined, undefined, '900px'
  );
}
