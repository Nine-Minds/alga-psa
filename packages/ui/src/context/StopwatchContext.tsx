'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { StopwatchEntrySpanView, StopwatchSessionView } from '@alga-psa/types';

/**
 * Injection point for the server-side stopwatch (plan D10). The implementation
 * (StopwatchProvider) lives in @alga-psa/scheduling; packages/tickets and the app shell
 * read it through this context so they never import scheduling.
 *
 * Time is NEVER counted client-side. `getElapsedMs()` derives the value from the session's
 * segments and the server clock offset on every call, so a sleeping laptop or a throttled
 * background tab cannot undercount. `useStopwatchElapsedMs()` only re-renders once a second.
 */

export type StopwatchState = 'idle' | 'running' | 'paused';

export interface StopwatchStartInput {
  workItemType: 'ticket' | 'project_task';
  workItemId: string;
  serviceId?: string | null;
  notes?: string;
}

export type StopwatchStartResult =
  | { status: 'started'; session: StopwatchSessionView }
  /** The user already has an open session. Nothing was started. */
  | { status: 'conflict'; openSession: StopwatchSessionView }
  | { status: 'error'; message: string };

export type StopwatchActionResult =
  | { status: 'ok'; session: StopwatchSessionView | null }
  | { status: 'error'; message: string };

/**
 * Opens the time-entry drawer for a paused session. `span` is the D5 span (start/end/minutes);
 * call `onLogged` once the entry was saved so the provider can refresh. The consumer supplies
 * this because it owns the drawer and the TimeEntryWorkItemContext builder.
 */
export type StopwatchLogLauncher = (args: {
  session: StopwatchSessionView;
  span: StopwatchEntrySpanView;
  onLogged: () => void;
}) => Promise<void> | void;

export interface StopwatchContextValue {
  /** The user's open (running or paused) session, or null. */
  session: StopwatchSessionView | null;
  state: StopwatchState;
  /** True until the first fetch settled. */
  isLoading: boolean;
  /** Milliseconds to add to Date.now() to estimate server time. */
  serverOffsetMs: number;
  /** Active milliseconds right now, derived from segments + offset. Not memoised: call at render. */
  getElapsedMs: () => number;
  /** D5 span for a session at the estimated server time (what the drawer is prefilled with). */
  getEntrySpan: (session: StopwatchSessionView) => StopwatchEntrySpanView;
  /**
   * Starts a session. On conflict the provider shows its conflict dialog; choosing
   * "Stop and log current" hands the current session to `launchLog`, then starts after it was
   * logged. Resolves with the final outcome (conflict only if the user dismissed the dialog).
   */
  start: (input: StopwatchStartInput, launchLog?: StopwatchLogLauncher) => Promise<StopwatchStartResult>;
  pause: () => Promise<StopwatchActionResult>;
  resume: () => Promise<StopwatchActionResult>;
  /** D4: pauses a running session, then hands it to `launchLog`. Cancelling the drawer leaves it paused. */
  requestStop: (launchLog: StopwatchLogLauncher) => Promise<StopwatchActionResult>;
  /** Always asks for confirmation (provider-rendered dialog). Resolves true when discarded. */
  requestDiscard: () => Promise<boolean>;
  /** Persist the draft notes on the open session. */
  updateNotes: (notes: string) => Promise<StopwatchActionResult>;
  refresh: () => Promise<void>;
}

const notAvailable = async (): Promise<StopwatchActionResult> => ({
  status: 'error',
  message: '',
});

const defaultStopwatch: StopwatchContextValue = {
  session: null,
  state: 'idle',
  isLoading: false,
  serverOffsetMs: 0,
  getElapsedMs: () => 0,
  getEntrySpan: () => {
    const now = new Date();
    return { start: now, end: now, billableMinutes: 1, pausedMs: 0, segmentCount: 0 };
  },
  start: async () => ({ status: 'error', message: '' }),
  pause: notAvailable,
  resume: notAvailable,
  requestStop: notAvailable,
  requestDiscard: async () => false,
  updateNotes: notAvailable,
  refresh: async () => {},
};

const StopwatchContext = createContext<StopwatchContextValue>(defaultStopwatch);

export const StopwatchContextProvider = StopwatchContext.Provider;

export function useStopwatch(): StopwatchContextValue {
  return useContext(StopwatchContext);
}

/**
 * Elapsed milliseconds of the open session, re-rendered every second while running (and on
 * tab visibility). The ticker carries no state: the value is re-derived from the session on each
 * render, so a 10-minute jump with no ticks still shows 10 minutes.
 */
export function useStopwatchElapsedMs(): number {
  const { getElapsedMs, state } = useStopwatch();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (state !== 'running') return undefined;
    const bump = () => setTick((n) => n + 1);
    const interval = setInterval(bump, 1000);
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') bump();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state]);

  return getElapsedMs();
}

/** hh:mm:ss, hours not capped. */
export function formatStopwatchClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * "1h 30m" / "45m" / "0m", localised through Intl unit formatting (no hard-coded unit words).
 * Rounds to the nearest minute.
 */
export function formatStopwatchDuration(durationMs: number, locale?: string): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'hour' | 'minute') => {
    try {
      return new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
    } catch {
      return `${value}${name === 'hour' ? 'h' : 'm'}`;
    }
  };
  return hours > 0 ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(minutes, 'minute');
}

export { StopwatchContext };
