'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Pause, Play, StopCircle, Timer, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@alga-psa/ui/components/Popover';
import { useDrawer } from '@alga-psa/ui';
import { formatStopwatchClock, useStopwatch, useStopwatchElapsedMs } from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { launchTimeEntryForWorkItem } from '@alga-psa/scheduling/lib/timeEntryLauncher';
import { createStopwatchLogLauncher } from '@alga-psa/tickets/lib/stopwatchLogLauncher';
import { createHeaderStopLauncher } from './stopwatchHeaderStop';

/**
 * Header chip for the user's open stopwatch session (plan D9). Visible on every MSP page, hidden
 * when there is no open session. Reads everything from the injected StopwatchContext.
 */
export default function StopwatchHeaderIndicator() {
  const { t } = useTranslation('msp/core');
  const { t: tTimeEntry } = useTranslation('msp/time-entry');
  const { locale } = useFormatters();
  const { openDrawer, closeDrawer, hasOutlet } = useDrawer();
  const { session, state, pause, resume, requestStop, requestDiscard } = useStopwatch();
  const elapsedMs = useStopwatchElapsedMs();

  const handleStop = useCallback(() => {
    const drawerLauncher = createStopwatchLogLauncher({
      openDrawer,
      closeDrawer,
      launchTimeEntry: launchTimeEntryForWorkItem,
      translate: (key, defaultValue, options) => tTimeEntry(key, { defaultValue, ...options }),
      locale,
    });
    void requestStop(createHeaderStopLauncher({
      hasOutlet,
      drawerLauncher,
      notifyPausedWithoutDrawer: (paused) => {
        const clock = formatStopwatchClock(paused.active_ms);
        const href = paused.work_item_type === 'ticket' && paused.work_item_id
          ? `/msp/tickets/${paused.work_item_id}`
          : null;
        toast(
          <span>
            {t('header.stopwatch.pausedNoDrawer', {
              defaultValue: 'Stopwatch paused at {{clock}}. Open the work item to log the time.',
              clock,
            })}
            {href ? (
              <>
                {' '}
                <Link id="stopwatch-header-toast-open-ticket" href={href} className="font-semibold underline">
                  {t('header.stopwatch.openTicket', { defaultValue: 'Open ticket' })}
                </Link>
              </>
            ) : null}
          </span>,
          { duration: 12000 },
        );
      },
    }));
  }, [closeDrawer, hasOutlet, locale, openDrawer, requestStop, t, tTimeEntry]);

  if (!session || state === 'idle') {
    return null;
  }

  const isPaused = state === 'paused';
  const isTicket = session.work_item_type === 'ticket' && !!session.work_item_id;
  const label = session.ticket_number
    ? `#${session.ticket_number}${session.work_item_title ? ` ${session.work_item_title}` : ''}`
    : session.work_item_title || session.project_name || t('header.stopwatch.untitled', { defaultValue: 'Stopwatch' });
  const clock = formatStopwatchClock(elapsedMs);
  const href = isTicket ? `/msp/tickets/${session.work_item_id}` : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="stopwatch-header-trigger"
          variant="ghost"
          size="sm"
          aria-label={t(isPaused ? 'header.stopwatch.ariaLabelPaused' : 'header.stopwatch.ariaLabelRunning', {
            defaultValue: isPaused ? 'Stopwatch paused: {{label}} at {{clock}}' : 'Stopwatch running: {{label}} at {{clock}}',
            label,
            clock,
          })}
          className={`h-9 gap-2 px-2 ${isPaused ? 'text-amber-700' : 'text-emerald-700'}`}
        >
          <Timer className="h-4 w-4" />
          <span id="stopwatch-header-clock" className="font-mono text-sm">{clock}</span>
          <span className="hidden max-w-[10rem] truncate text-xs text-gray-600 xl:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className={`text-xs font-medium ${isPaused ? 'text-amber-700' : 'text-emerald-700'}`}>
              {isPaused
                ? t('header.stopwatch.paused', { defaultValue: 'Stopwatch paused' })
                : t('header.stopwatch.running', { defaultValue: 'Stopwatch running' })}
            </p>
            {href ? (
              <Link
                id="stopwatch-header-ticket-link"
                href={href}
                className="block truncate text-sm font-semibold text-[rgb(var(--color-primary-600))] hover:underline"
              >
                {label}
              </Link>
            ) : (
              <p className="truncate text-sm font-semibold text-gray-900">{label}</p>
            )}
            {session.client_name ? <p className="truncate text-xs text-gray-500">{session.client_name}</p> : null}
          </div>
          <div className="font-mono text-2xl text-gray-900">{clock}</div>
          <div className="flex flex-wrap gap-2">
            {isPaused ? (
              <Button id="stopwatch-header-resume" size="sm" variant="soft" onClick={() => { void resume(); }}>
                <Play className="mr-1 h-4 w-4" />
                {t('header.stopwatch.resume', { defaultValue: 'Resume' })}
              </Button>
            ) : (
              <Button id="stopwatch-header-pause" size="sm" variant="soft" onClick={() => { void pause(); }}>
                <Pause className="mr-1 h-4 w-4" />
                {t('header.stopwatch.pause', { defaultValue: 'Pause' })}
              </Button>
            )}
            <Button id="stopwatch-header-stop" size="sm" variant="soft" onClick={handleStop}>
              <StopCircle className="mr-1 h-4 w-4" />
              {t('header.stopwatch.stop', { defaultValue: 'Stop and log' })}
            </Button>
            <Button id="stopwatch-header-discard" size="sm" variant="ghost" onClick={() => { void requestDiscard(); }}>
              <Trash2 className="mr-1 h-4 w-4" />
              {t('header.stopwatch.discard', { defaultValue: 'Discard' })}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
