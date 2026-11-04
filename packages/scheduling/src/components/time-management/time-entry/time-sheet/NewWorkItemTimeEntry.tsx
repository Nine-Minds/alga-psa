'use client';

import React, { useMemo } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IExtendedWorkItem, ITimePeriodWithStatusView } from '@alga-psa/types';
import { dateOnlyToLocalDate, type ResolvedEntryDefaults } from '../../../../lib/timeEntryPeriodSelection';
import {
  createCatalogSheetResolver,
  createTimeEntrySaveHandler,
  sheetStatusLabel,
} from '../../../../lib/timeEntrySaveAdapter';
import TimeEntryDialog from './TimeEntryDialog';

interface NewWorkItemTimeEntryProps {
  closeDrawer: () => void;
  onComplete?: () => void;
  workItem: Omit<IExtendedWorkItem, 'tenant'>;
  userId: string;
  userTimeZone: string;
  periods: ITimePeriodWithStatusView[];
  /** From resolveEntryDefaults; always lands on an editable day. */
  defaults: ResolvedEntryDefaults;
  /** Caller-supplied explanation shown above the form (e.g. the stopwatch pause summary). */
  contextNotice?: string;
  /** Stopwatch session this entry logs; saving closes it atomically. */
  stopwatchSessionId?: string;
}

/**
 * A new entry from a work item. The user picks the day the work happened; the
 * sheet follows from that day. The date field spans every editable period, the
 * form names the sheet the chosen day lands on, and the sheet is resolved (and
 * created if needed) only when the entry is saved.
 */
export default function NewWorkItemTimeEntry({
  closeDrawer,
  onComplete,
  workItem,
  userId,
  userTimeZone,
  periods,
  defaults,
  contextNotice,
  stopwatchSessionId,
}: NewWorkItemTimeEntryProps): React.JSX.Element {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();

  const formatWorkDate = useMemo(
    () => (workDate: string) => formatDate(dateOnlyToLocalDate(workDate), { dateStyle: 'medium' }),
    [formatDate],
  );

  const handleSave = useMemo(
    () =>
      createTimeEntrySaveHandler(
        onComplete,
        createCatalogSheetResolver({ userId, periods, timeZone: userTimeZone, formatWorkDate }),
        { stopwatchSessionId },
      ),
    [onComplete, userId, periods, userTimeZone, formatWorkDate, stopwatchSessionId],
  );

  const movedNotice = useMemo(() => {
    const { moved } = defaults;
    if (moved.kind === 'supplied') {
      return t('workItemEntry.defaultMoved.supplied', {
        date: formatWorkDate(moved.date),
        defaultValue: 'The timer’s times fall on a day that can’t take new time, so the entry starts on {{date}} at 08:00.',
      });
    }
    if (moved.kind === 'today') {
      return moved.todayStatus
        ? t('workItemEntry.defaultMoved.todayLocked', {
            date: formatWorkDate(moved.date),
            status: sheetStatusLabel(moved.todayStatus),
            defaultValue: 'Today’s time sheet is {{status}}, so the entry starts on {{date}}, the nearest day that can take time.',
          })
        : t('workItemEntry.defaultMoved.todayUncovered', {
            date: formatWorkDate(moved.date),
            defaultValue: 'No time period covers today, so the entry starts on {{date}}, the nearest day that can take time.',
          });
    }
    return undefined;
  }, [defaults, formatWorkDate, t]);

  const notice = useMemo(
    () => [contextNotice, movedNotice].filter(Boolean).join(' ') || undefined,
    [contextNotice, movedNotice],
  );

  return (
    <TimeEntryDialog
      isOpen={true}
      onClose={closeDrawer}
      onSave={handleSave}
      workItem={workItem}
      date={defaults.date}
      periodCatalog={periods}
      isEditable={true}
      defaultStartTime={defaults.defaultStartTime}
      defaultEndTime={defaults.defaultEndTime}
      inDrawer={true}
      notice={notice}
      workTimeZone={userTimeZone}
    />
  );
}
