'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { useFormatters, translate } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentTimePeriod, getTimeEntryUserTimeZone } from '../actions/timePeriodsActions';
import { fetchTimePeriods, getTimeEntryById } from '../actions/timeEntryActions';
import { fetchTimeSheet } from '../actions/timeSheetActions';
import { isEditableSheetStatus, dateOnlyToLocalDate, periodLastInclusiveDay } from './timeEntryPeriodSelection';
import { createTimeEntrySaveHandler } from './timeEntrySaveAdapter';
import type {
  IExtendedWorkItem,
  ITimeEntryWithWorkItem,
  ITimeSheetView,
  TimeEntryWorkItemContext,
} from '@alga-psa/types';
import TimeEntryDialog from '../components/time-management/time-entry/time-sheet/TimeEntryDialog';
import TimeEntryPeriodLauncher from '../components/time-management/time-entry/time-sheet/TimeEntryPeriodLauncher';
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

// Launcher failures fire outside a React tree, so they translate through the
// module-level helper; the English default keeps them readable before the
// namespace loads.
const launchMessage = (key: string, fallback: string): string =>
  translate('msp/time-entry', `launch.${key}`, { defaultValue: fallback });

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

const saveAndComplete = createTimeEntrySaveHandler;

interface AnchoredTimeEntryDialogProps {
  existingEntry: ITimeEntryWithWorkItem;
  savedSheet: ITimeSheetView;
  workItem: Omit<IExtendedWorkItem, 'tenant'>;
  onClose: () => void;
  onComplete?: () => void;
  workTimeZone?: string;
}

/**
 * An existing entry is edited against its own saved sheet: the sheet's actual
 * period bounds the date field and its status decides editability. A small
 * component so the period context label uses the application formatter.
 */
function AnchoredTimeEntryDialog({
  existingEntry,
  savedSheet,
  workItem,
  onClose,
  onComplete,
  workTimeZone,
}: AnchoredTimeEntryDialogProps): React.JSX.Element {
  const { formatDate } = useFormatters();
  const timePeriod = savedSheet.time_period!;
  const periodContextLabel = `${formatDate(dateOnlyToLocalDate(timePeriod.start_date), {
    dateStyle: 'medium',
  })} – ${formatDate(dateOnlyToLocalDate(periodLastInclusiveDay(timePeriod.end_date)), {
    dateStyle: 'medium',
  })}`;

  return (
    <TimeEntryDialog
      isOpen={true}
      onClose={onClose}
      onSave={saveAndComplete(onComplete)}
      workItem={workItem}
      date={new Date(existingEntry.start_time)}
      existingEntries={[existingEntry]}
      timePeriod={timePeriod}
      isEditable={isEditableSheetStatus(savedSheet.approval_status)}
      timeSheetId={savedSheet.id}
      inDrawer={true}
      periodContextLabel={periodContextLabel}
      workTimeZone={workTimeZone}
    />
  );
}

async function launchExistingEntry(params: {
  existingEntryId: string;
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  context: TimeEntryWorkItemContext;
  onComplete?: () => void;
}): Promise<void> {
  const { existingEntryId, openDrawer, closeDrawer, context, onComplete } = params;

  const existingEntry = await getTimeEntryById(existingEntryId);
  if (isActionMessageError(existingEntry) || isActionPermissionError(existingEntry)) {
    launchBlockedToast(getErrorMessage(existingEntry));
    return;
  }
  if (!existingEntry) {
    launchBlockedToast(launchMessage('entryNotFound', 'Time entry not found.'));
    return;
  }
  if (!existingEntry.time_sheet_id) {
    launchBlockedToast(
      launchMessage(
        'entryMissingSheet',
        'This time entry is not attached to a time sheet, so it can’t be edited here.',
      ),
    );
    return;
  }

  const savedSheet = await fetchTimeSheet(existingEntry.time_sheet_id);
  if (isActionMessageError(savedSheet) || isActionPermissionError(savedSheet)) {
    launchBlockedToast(getErrorMessage(savedSheet));
    return;
  }
  if (!savedSheet.time_period) {
    launchBlockedToast(
      launchMessage(
        'entryMissingPeriod',
        'The time sheet for this entry is missing its period and can’t be opened.',
      ),
    );
    return;
  }

  openDrawer(
    <AnchoredTimeEntryDialog
      existingEntry={existingEntry as ITimeEntryWithWorkItem}
      savedSheet={savedSheet}
      workItem={buildWorkItem(context)}
      onClose={closeDrawer}
      onComplete={onComplete}
      workTimeZone={existingEntry.work_timezone ?? undefined}
    />,
    undefined,
    undefined,
    '900px',
  );
}

export async function launchTimeEntryForWorkItem({ openDrawer, closeDrawer, context, onComplete, existingEntryId }: LaunchTimeEntryParams): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user?.user_id) {
      launchBlockedToast(launchMessage('noUser', 'Unable to load current user for time entry.'));
      return;
    }

    if (existingEntryId) {
      await launchExistingEntry({ existingEntryId, openDrawer, closeDrawer, context, onComplete });
      return;
    }

    const [currentTimePeriod, periods, userTimeZone] = await Promise.all([
      getCurrentTimePeriod(),
      fetchTimePeriods(user.user_id),
      getTimeEntryUserTimeZone(),
    ]);

    if (isActionMessageError(currentTimePeriod) || isActionPermissionError(currentTimePeriod)) {
      launchBlockedToast(getErrorMessage(currentTimePeriod));
      return;
    }
    if (isActionMessageError(periods) || isActionPermissionError(periods)) {
      launchBlockedToast(getErrorMessage(periods));
      return;
    }
    if (isActionMessageError(userTimeZone) || isActionPermissionError(userTimeZone)) {
      launchBlockedToast(getErrorMessage(userTimeZone));
      return;
    }

    if (!periods.length) {
      launchBlockedToast(
        launchMessage(
          'noPeriods',
          'No time periods are set up yet, so time can’t be entered. Ask an administrator to create time periods under Settings → Time Entry.',
        ),
      );
      return;
    }

    openDrawer(
      <TimeEntryPeriodLauncher
        closeDrawer={closeDrawer}
        onComplete={onComplete}
        workItem={buildWorkItem(context)}
        context={context}
        userId={user.user_id}
        userTimeZone={typeof userTimeZone === 'string' ? userTimeZone : 'UTC'}
        periods={periods}
        currentPeriodId={currentTimePeriod ? currentTimePeriod.period_id : null}
      />,
      undefined,
      undefined,
      '900px',
    );
  } catch (error) {
    console.error('Failed to launch time entry dialog:', error);
    toast.error(
      launchMessage('prepareFailed', 'An error occurred while preparing the time entry. Please try again.'),
    );
  }
}
