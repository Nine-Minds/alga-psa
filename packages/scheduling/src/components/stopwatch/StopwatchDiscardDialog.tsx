'use client';

import React, { useMemo } from 'react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { formatStopwatchDuration } from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { StopwatchSessionView } from '@alga-psa/types';

/** "#1234 Title" / task name; display names only, never ids. */
export function stopwatchWorkItemLabel(session: StopwatchSessionView): string {
  const title = session.work_item_title?.trim();
  if (session.ticket_number) {
    return title ? `#${session.ticket_number} ${title}` : `#${session.ticket_number}`;
  }
  return title || session.project_name || '';
}

interface StopwatchDiscardDialogProps {
  session: StopwatchSessionView | null;
  /** Active milliseconds at the moment the dialog is shown. */
  elapsedMs: number;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Discard always asks for confirmation (D11). */
export function StopwatchDiscardDialog({ session, elapsedMs, onConfirm, onClose }: StopwatchDiscardDialogProps) {
  const { t } = useTranslation('msp/time-entry');
  const { locale } = useFormatters();
  if (!session) return null;
  return (
    <ConfirmationDialog
      id="stopwatch-discard-dialog"
      isOpen={true}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('stopwatch.discardDialog.title', 'Discard this stopwatch?')}
      message={t(
        'stopwatch.discardDialog.message',
        'The {{duration}} tracked on {{workItem}} will be deleted and no time entry will be created. This cannot be undone.',
        {
          duration: formatStopwatchDuration(elapsedMs, locale),
          workItem: stopwatchWorkItemLabel(session),
        },
      )}
      confirmLabel={t('stopwatch.discardDialog.confirm', 'Discard')}
      cancelLabel={t('stopwatch.discardDialog.cancel', 'Keep stopwatch')}
    />
  );
}

export type StopwatchConflictChoice = 'stop-and-log' | 'discard';

interface StopwatchConflictDialogProps {
  /** The session that is already open. */
  openSession: StopwatchSessionView | null;
  /** Whether the caller can open the time-entry drawer for the open session. */
  canLog: boolean;
  elapsedMs: number;
  onChoose: (choice: StopwatchConflictChoice) => Promise<void> | void;
  onClose: () => void;
}

/** Shown when starting while another session is open (D3). */
export function StopwatchConflictDialog({ openSession, canLog, elapsedMs, onChoose, onClose }: StopwatchConflictDialogProps) {
  const { t } = useTranslation('msp/time-entry');
  const { locale } = useFormatters();
  // ConfirmationDialog resets its radio selection whenever `options` changes identity.
  const options = useMemo(() => [
    ...(canLog
      ? [{ value: 'stop-and-log', label: t('stopwatch.conflictDialog.stopAndLog', 'Stop and log current, then start') }]
      : []),
    {
      value: 'discard',
      label: t('stopwatch.conflictDialog.discard', 'Discard current, then start (the tracked time is deleted)'),
    },
  ], [canLog, t]);

  if (!openSession) return null;

  return (
    <ConfirmationDialog
      id="stopwatch-conflict-dialog"
      isOpen={true}
      onClose={onClose}
      onConfirm={(value) => onChoose((value as StopwatchConflictChoice) ?? 'discard')}
      title={t('stopwatch.conflictDialog.title', 'A stopwatch is already open')}
      message={t(
        'stopwatch.conflictDialog.message',
        'You are already tracking {{duration}} on {{workItem}}. Only one stopwatch can be open at a time.',
        {
          duration: formatStopwatchDuration(elapsedMs, locale),
          workItem: stopwatchWorkItemLabel(openSession),
        },
      )}
      options={options}
      confirmLabel={t('stopwatch.conflictDialog.confirm', 'Continue')}
      cancelLabel={t('stopwatch.conflictDialog.cancel', 'Cancel')}
    />
  );
}
