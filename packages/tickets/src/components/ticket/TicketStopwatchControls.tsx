'use client';

import React, { useCallback, useState } from 'react';
import { Pause, Play, StopCircle, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useDrawer } from '@alga-psa/ui';
import {
  formatStopwatchClock,
  useSchedulingCallbacks,
  useStopwatch,
  useStopwatchElapsedMs,
} from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { createStopwatchLogLauncher } from '../../lib/stopwatchLogLauncher';

export interface TicketStopwatchControlsProps {
  id: string;
  ticketId: string;
  /** Layout density: the Grid layout tile, or the classic Time Entry card. */
  variant?: 'tile' | 'card';
  /** Board setting `enable_live_ticket_timer`: whether this board shows the stopwatch (D12). */
  enabled: boolean;
  /** Work description typed on the ticket screen; stored as the session notes. */
  timeDescription: string;
  onTimeDescriptionChange: (value: string) => void;
  masterTicketId?: string | null;
  masterTicketNumber?: string | null;
  /** Called after the time-entry drawer saved and the session was logged. */
  onTimeEntryLogged?: () => void;
}

/**
 * The stopwatch on a ticket: presentational, driven by the server session in StopwatchContext
 * (plan D9). Used by BOTH the Grid layout time tile and the classic Time Entry card.
 */
export function TicketStopwatchControls({
  id,
  ticketId,
  variant = 'tile',
  enabled,
  timeDescription,
  onTimeDescriptionChange,
  masterTicketId,
  masterTicketNumber,
  onTimeEntryLogged,
}: TicketStopwatchControlsProps) {
  const { t } = useTranslation('features/tickets');
  const { t: tTimeEntry } = useTranslation('msp/time-entry');
  const { locale } = useFormatters();
  const { openDrawer, closeDrawer } = useDrawer();
  const { launchTimeEntry } = useSchedulingCallbacks();
  const stopwatch = useStopwatch();
  const { session, state } = stopwatch;
  const elapsedMs = useStopwatchElapsedMs();
  const [busy, setBusy] = useState(false);

  const onThisTicket = !!session && session.work_item_type === 'ticket' && session.work_item_id === ticketId;
  const elsewhere = !!session && !onThisTicket;
  const isPaused = state === 'paused';

  const launchLog = useCallback(
    () =>
      createStopwatchLogLauncher({
        openDrawer,
        closeDrawer,
        launchTimeEntry,
        translate: (key, defaultValue, options) => tTimeEntry(key, { defaultValue, ...options }),
        locale,
        descriptionOverride: timeDescription,
        masterTicketId,
        masterTicketNumber,
        onSaved: onTimeEntryLogged,
      }),
    [closeDrawer, launchTimeEntry, locale, masterTicketId, masterTicketNumber, onTimeEntryLogged, openDrawer, tTimeEntry, timeDescription, ],
  );

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStart = () =>
    run(() =>
      stopwatch.start(
        { workItemType: 'ticket', workItemId: ticketId, notes: timeDescription.trim() || undefined },
        launchLog(),
      ),
    );
  const handleStop = () => run(() => stopwatch.requestStop(launchLog()));
  const handleDescriptionBlur = () => {
    if (onThisTicket && session && (session.notes ?? '') !== timeDescription) {
      void stopwatch.updateNotes(timeDescription);
    }
  };

  // D12: a board with the stopwatch off hides the controls, unless this ticket already holds the
  // user's open session (it stays stoppable).
  if (!enabled && !onThisTicket) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid={`${id}-stopwatch-disabled-message`}
        id={`${id}-stopwatch-disabled-message`}
      >
        {t('stopwatch.boardDisabled', 'The stopwatch is turned off for this board.')}
      </p>
    );
  }

  const isCard = variant === 'card';
  const sessionLabel = session
    ? session.ticket_number
      ? `#${session.ticket_number}${session.work_item_title ? ` ${session.work_item_title}` : ''}`
      : session.work_item_title || session.project_name || ''
    : '';

  return (
    <div id={`${id}-stopwatch`} className={isCard ? 'space-y-3' : 'mb-3 space-y-2'}>
      {elsewhere && session ? (
        <div
          id={`${id}-stopwatch-elsewhere`}
          className="flex items-center justify-between gap-2 rounded-md bg-[rgb(var(--color-border-100))] px-3 py-2 text-sm"
        >
          <span className="min-w-0 truncate" title={sessionLabel}>
            {session.work_item_type === 'ticket'
              ? t(isPaused ? 'stopwatch.pausedElsewhereTicket' : 'stopwatch.runningElsewhereTicket',
                  isPaused ? 'Paused on another ticket: {{label}}' : 'Running on another ticket: {{label}}',
                  { label: sessionLabel })
              : t(isPaused ? 'stopwatch.pausedElsewhereTask' : 'stopwatch.runningElsewhereTask',
                  isPaused ? 'Paused on another task: {{label}}' : 'Running on another task: {{label}}',
                  { label: sessionLabel })}
          </span>
          <Button
            {...withDataAutomationId({ id: `${id}-stopwatch-switch` })}
            variant="soft"
            size="sm"
            disabled={busy}
            onClick={handleStart}
          >
            {t('stopwatch.switch', 'Switch here')}
          </Button>
        </div>
      ) : (
        <div
          className={`flex items-center justify-between rounded-md bg-[rgb(var(--color-border-100))] px-3 py-2 font-mono text-[rgb(var(--color-text-900))] ${isCard ? 'text-2xl' : 'text-xl'} ${isPaused ? 'opacity-70' : ''}`}
        >
          <span id={`${id}-stopwatch-clock`} aria-live="off">
            {formatStopwatchClock(onThisTicket ? elapsedMs : 0)}
          </span>
          <div className="flex items-center gap-1">
            {!onThisTicket ? (
              <Button
                {...withDataAutomationId({ id: `${id}-stopwatch-start` })}
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={handleStart}
                aria-label={t('stopwatch.start', 'Start stopwatch')}
                title={t('stopwatch.start', 'Start stopwatch')}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : isPaused ? (
              <Button
                {...withDataAutomationId({ id: `${id}-stopwatch-resume` })}
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => stopwatch.resume())}
                aria-label={t('stopwatch.resume', 'Resume stopwatch')}
                title={t('stopwatch.resume', 'Resume stopwatch')}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                {...withDataAutomationId({ id: `${id}-stopwatch-pause` })}
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => stopwatch.pause())}
                aria-label={t('stopwatch.pause', 'Pause stopwatch')}
                title={t('stopwatch.pause', 'Pause stopwatch')}
              >
                <Pause className="h-4 w-4" />
              </Button>
            )}
            {onThisTicket ? (
              <>
                <Button
                  {...withDataAutomationId({ id: `${id}-stopwatch-stop` })}
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={handleStop}
                  aria-label={t('stopwatch.stop', 'Stop and log time')}
                  title={t('stopwatch.stop', 'Stop and log time')}
                >
                  <StopCircle className="h-4 w-4" />
                </Button>
                <Button
                  {...withDataAutomationId({ id: `${id}-stopwatch-discard` })}
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => stopwatch.requestDiscard())}
                  aria-label={t('stopwatch.discard', 'Discard stopwatch')}
                  title={t('stopwatch.discard', 'Discard stopwatch')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
      {onThisTicket && isPaused ? (
        <p id={`${id}-stopwatch-paused-hint`} className="text-xs text-[rgb(var(--color-text-500))]">
          {t('stopwatch.pausedHint', 'Paused. Resume to keep tracking, or stop to log the time.')}
        </p>
      ) : null}
      {!elsewhere ? (
        <div>
          <Label htmlFor={`${id}-stopwatch-description`}>{t('stopwatch.workDescription', 'Work description')}</Label>
          <Input
            id={`${id}-stopwatch-description`}
            value={timeDescription}
            onChange={(event) => onTimeDescriptionChange(event.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder={t('stopwatch.whatAreYouWorkingOn', 'What are you working on?')}
            containerClassName="mb-0"
          />
        </div>
      ) : null}
    </div>
  );
}

export default TicketStopwatchControls;
