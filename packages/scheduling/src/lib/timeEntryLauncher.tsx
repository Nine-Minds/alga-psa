'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from '@alga-psa/users/actions';
import { getCurrentTimePeriod } from '../actions/timePeriodsActions';
import { fetchOrCreateTimeSheet, saveTimeEntry } from '../actions/timeEntryActions';
import type { IExtendedWorkItem, TimeEntryWorkItemContext } from '@alga-psa/types';
import TimeEntryDialog from '../components/time-management/time-entry/time-sheet/TimeEntryDialog';
import type { OpenDrawerFn } from '@alga-psa/ui/context';

interface LaunchTimeEntryParams {
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  context: TimeEntryWorkItemContext;
  onComplete?: () => void;
}

const buildWorkItem = (context: TimeEntryWorkItemContext): Omit<IExtendedWorkItem, 'tenant'> => {
  return {
    work_item_id: context.workItemId,
    type: context.workItemType,
    name: context.workItemName,
    description: context.timeDescription || '',
    ticket_number: context.ticketNumber,
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

export async function launchTimeEntryForWorkItem({ openDrawer, closeDrawer, context, onComplete }: LaunchTimeEntryParams): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user?.user_id) {
      toast.error('Unable to load current user for time entry.');
      return;
    }

    const currentTimePeriod = await getCurrentTimePeriod();
    if (!currentTimePeriod) {
      toast.error('No active time period found. Please configure time periods before entering time.');
      return;
    }

    const timeSheet = await fetchOrCreateTimeSheet(user.user_id, currentTimePeriod.period_id);
    const workItem = buildWorkItem(context);
    const { defaultStartTime, defaultEndTime } = deriveDefaultTimes(context);
    const date = context.startTime || defaultStartTime || new Date();

    openDrawer(
      <TimeEntryDialog
        isOpen={true}
        onClose={closeDrawer}
        onSave={async (timeEntry) => {
          try {
            await saveTimeEntry(timeEntry);
            closeDrawer();
            if (onComplete) onComplete();
          } catch (error) {
            console.error('Failed to save time entry:', error);
            toast.error('Failed to save time entry. Please try again.');
          }
        }}
        workItem={workItem}
        date={date}
        timePeriod={currentTimePeriod}
        isEditable={true}
        defaultStartTime={defaultStartTime}
        defaultEndTime={defaultEndTime}
        timeSheetId={timeSheet.id}
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
