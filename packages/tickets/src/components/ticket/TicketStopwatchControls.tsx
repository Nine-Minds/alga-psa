'use client';

import React, { useCallback, useState } from 'react';
import { Pause, Play, StopCircle, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
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
import { resolveTicketTimeWorkItem } from '../../lib/ticketDataSource';
import { useTicketDataSource } from './TicketDataSourceContext';

export interface TicketStopwatchControlsProps {
  id: string;
  ticketId: string;
  /**
   * Layout: the Grid layout tile, the classic Time Entry card, the Grid hero's
   * compact clock chip, or the tile's notes-only body when the hero chip owns the clock.
   */
  variant?: 'tile' | 'card' | 'chip' | 'notes';
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
  const timeWorkItem = resolveTicketTimeWorkItem(useTicketDataSource(), { ticket_id: ticketId });
  const { session, state } = stopwatch;
  const elapsedMs = useStopwatchElapsedMs();
  const [busy, setBusy] = useState(false);

  const onThisTicket = !!session && session.work_item_type === timeWorkItem.workItemType && session.work_item_id === timeWorkItem.workItemId;
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

  const trackedType = timeWorkItem.workItemType;
  const handleStart = () =>
    run(() =>
      stopwatch.start(
        { workItemType: trackedType as 'ticket' | 'project_task', workItemId: timeWorkItem.workItemId, notes: timeDescription.trim() || undefined },
        launchLog(),
      ),
    );
  const handleStop = () => run(() => stopwatch.requestStop(launchLog()));
  const handleDescriptionBlur = () => {
    if (onThisTicket && session && (session.notes ?? '') !== timeDescription) {
      void stopwatch.updateNotes(timeDescription);
    }
  };

  // The session store books ticket and project_task work only; other work item types book time
  // through the time entry flow.
  if (trackedType !== 'ticket' && trackedType !== 'project_task') {
    return null;
  }

  // D12: a board with the stopwatch off hides the controls, unless this ticket already holds the
  // user's open session (it stays stoppable).
  if (!enabled && !onThisTicket) {
    if (variant === 'chip') return null;
    // The notes body is the only place a manual entry's work description is typed when the
    // hero chip is absent: the disabled board hides the clock and its controls, not this field.
    if (variant === 'notes') {
      return (
        <div id={`${id}-stopwatch`}>
          <Label htmlFor={`${id}-stopwatch-description`}>{t('stopwatch.workDescription', 'Work description')}</Label>
          <Input
            id={`${id}-stopwatch-description`}
            data-testid={`${id}-stopwatch-description`}
            value={timeDescription}
            onChange={(event) => onTimeDescriptionChange(event.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder={t('stopwatch.whatAreYouWorkingOn', 'What are you working on?')}
            containerClassName="mb-0"
          />
        </div>
      );
    }
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

  // LEVERAGE: pattern stopwatch-controls — chip and tile render the same
  // play/pause/stop cluster; a shared StopwatchButtons piece would serve both.
  // The Work description label+input is also written three times (chip popover,
  // notes-off branch, tile body); a shared WorkDescriptionField would serve all.
  if (variant === 'chip') {
    // Running on another ticket/task: name it and offer the switch, so moving
    // the clock to this ticket stays one click from the header.
    if (elsewhere && session) {
      const elsewhereLabel =
        session.work_item_type === 'ticket'
          ? t(isPaused ? 'stopwatch.pausedElsewhereTicket' : 'stopwatch.runningElsewhereTicket',
              isPaused ? 'Paused on another ticket: {{label}}' : 'Running on another ticket: {{label}}',
              { label: sessionLabel })
          : t(isPaused ? 'stopwatch.pausedElsewhereTask' : 'stopwatch.runningElsewhereTask',
              isPaused ? 'Paused on another task: {{label}}' : 'Running on another task: {{label}}',
              { label: sessionLabel });
      return (
        <div
          id={`${id}-stopwatch-elsewhere`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pl-2.5 pr-0.5 h-8 text-xs text-[rgb(var(--color-text-600))] max-w-[16rem]"
          title={elsewhereLabel}
        >
          {/* Short form in the header; the full sentence is the tooltip. */}
          <span className="min-w-0 truncate">
            {t('stopwatch.chipElsewhere', 'Timer on {{label}}', {
              label: session.ticket_number ? `#${session.ticket_number}` : sessionLabel,
            })}
          </span>
          <Button
            {...withDataAutomationId({ id: `${id}-stopwatch-switch` })}
            variant="soft"
            size="sm"
            className="h-7 flex-shrink-0"
            disabled={busy}
            onClick={handleStart}
          >
            {t('stopwatch.switch', 'Switch here')}
          </Button>
        </div>
      );
    }
    return (
      <div
        id={`${id}-stopwatch`}
        className={`inline-flex items-center gap-1 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] pl-2.5 pr-0.5 h-8 font-mono text-sm text-[rgb(var(--color-text-800))] ${isPaused ? 'opacity-70' : ''}`}
        title={t('stopwatch.title', 'Stopwatch')}
      >
        {/* The clock opens the work description: one control for the whole
            stopwatch flow (describe, run, stop and log). */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              id={`${id}-stopwatch-clock`}
              type="button"
              aria-live="off"
              title={timeDescription || t('stopwatch.whatAreYouWorkingOn', 'What are you working on?')}
              className={`hover:underline decoration-dotted underline-offset-4 ${onThisTicket && !isPaused ? 'text-[rgb(var(--color-primary-600))]' : ''}`}
            >
              {formatStopwatchClock(onThisTicket ? elapsedMs : 0)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3 font-sans">
            <Label htmlFor={`${id}-stopwatch-description`}>{t('stopwatch.workDescription', 'Work description')}</Label>
            <Input
              id={`${id}-stopwatch-description`}
              value={timeDescription}
              onChange={(event) => onTimeDescriptionChange(event.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder={t('stopwatch.whatAreYouWorkingOn', 'What are you working on?')}
              containerClassName="mb-0"
            />
          </PopoverContent>
        </Popover>
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
    );
  }


  return (
    <div id={`${id}-stopwatch`} className={isCard ? 'space-y-3' : 'mb-3 space-y-2'}>
      {/* Notes body: the hero chip owns the clock, but "running elsewhere" still shows here. */}
      {variant === 'notes' && !elsewhere ? null : elsewhere && session ? (
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
