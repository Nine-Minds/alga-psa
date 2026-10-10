'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  StopwatchContextProvider,
  type StopwatchActionResult,
  type StopwatchContextValue,
  type StopwatchLogLauncher,
  type StopwatchStartInput,
  type StopwatchStartResult,
} from '@alga-psa/ui/context';
import { useActionPolling } from '@alga-psa/ui/hooks';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { StopwatchSessionView } from '@alga-psa/types';
import {
  discardStopwatch,
  getMyStopwatch,
  pauseStopwatch,
  resumeStopwatch,
  startStopwatch,
  updateStopwatchDraft,
} from '../actions/stopwatchActions';
import { activeMs, clockOffset, toEntrySpan } from '../lib/stopwatch/stopwatchMath';
import {
  StopwatchConflictDialog,
  StopwatchDiscardDialog,
  type StopwatchConflictChoice,
} from '../components/stopwatch/StopwatchDiscardDialog';

const POLL_INTERVAL_MS = 15_000;
const CHANNEL_NAME = 'alga-stopwatch';

// LEGACY STORE PURGE (D16): `purgeLegacyTicketTimerStore()` (indexedDB.deleteDatabase('TicketTimeTrackingDB'),
// gated by a localStorage flag) is mounted here by the removal change; intentionally absent from this one.

function isOpen(session: StopwatchSessionView | null | undefined): session is StopwatchSessionView {
  return !!session && (session.status === 'running' || session.status === 'paused');
}

type PendingDialog =
  | { kind: 'discard'; resolve: (discarded: boolean) => void }
  | {
      kind: 'conflict';
      input: StopwatchStartInput;
      launchLog?: StopwatchLogLauncher;
      resolve: (result: StopwatchStartResult) => void;
    };

export interface StopwatchProviderProps {
  children: React.ReactNode;
}

/**
 * Holds the signed-in user's open stopwatch session (plan D10). The server is the only clock:
 * state is refreshed by polling, focus and a same-browser BroadcastChannel, and the displayed
 * time is always re-derived from the session segments plus the server clock offset.
 */
export function StopwatchProvider({ children }: StopwatchProviderProps) {
  const [session, setSession] = useState<StopwatchSessionView | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [dialog, setDialog] = useState<PendingDialog | null>(null);

  const sessionRef = useRef<StopwatchSessionView | null>(null);
  const offsetRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  // Bumped on every local mutation so a slower in-flight poll cannot overwrite newer state.
  const versionRef = useRef(0);

  const apply = useCallback((view: StopwatchSessionView | null) => {
    if (view) {
      const offset = clockOffset(view.server_now, Date.now());
      offsetRef.current = offset;
      setServerOffsetMs(offset);
    }
    const next = isOpen(view) ? view : null;
    sessionRef.current = next;
    setSession(next);
  }, []);

  const notifyOtherTabs = useCallback(() => {
    try {
      channelRef.current?.postMessage({ type: 'changed' });
    } catch {
      // Channel closed; other tabs catch up through polling.
    }
  }, []);

  const fetchOpenSession = useCallback(async () => {
    const versionAtStart = versionRef.current;
    try {
      const result = await getMyStopwatch();
      if (versionAtStart !== versionRef.current) return;
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        // Users without time entry access simply have no stopwatch.
        apply(null);
        return;
      }
      apply(result);
    } finally {
      setIsLoading(false);
    }
  }, [apply]);

  const { runNow } = useActionPolling(fetchOpenSession, { intervalMs: POLL_INTERVAL_MS });

  useEffect(() => {
    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void runNow();
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => { void runNow(); };
      channelRef.current = channel;
    }
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      channel?.close();
      channelRef.current = null;
    };
  }, [runNow]);

  const getElapsedMs = useCallback(() => {
    const current = sessionRef.current;
    return current ? activeMs(current.segments, Date.now() + offsetRef.current) : 0;
  }, []);

  const getEntrySpan = useCallback(
    (target: StopwatchSessionView) => toEntrySpan(target.segments, Date.now() + offsetRef.current),
    [],
  );

  /** Runs a mutation, applies the returned session, toasts failures, tells other tabs. */
  const mutate = useCallback(async (
    run: () => Promise<unknown>,
  ): Promise<StopwatchActionResult> => {
    versionRef.current += 1;
    try {
      const result = await run();
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        const message = getErrorMessage(result);
        toast.error(message);
        return { status: 'error', message };
      }
      const view = result as StopwatchSessionView | null;
      apply(view);
      notifyOtherTabs();
      return { status: 'ok', session: isOpen(view) ? view : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      return { status: 'error', message };
    }
  }, [apply, notifyOtherTabs]);

  const pause = useCallback(async (): Promise<StopwatchActionResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'ok', session: null };
    return mutate(() => pauseStopwatch(current.session_id));
  }, [mutate]);

  const resume = useCallback(async (): Promise<StopwatchActionResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'ok', session: null };
    return mutate(() => resumeStopwatch(current.session_id));
  }, [mutate]);

  const updateNotes = useCallback(async (notes: string): Promise<StopwatchActionResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'ok', session: null };
    return mutate(() => updateStopwatchDraft(current.session_id, { notes }));
  }, [mutate]);

  const requestStop = useCallback(async (launchLog: StopwatchLogLauncher): Promise<StopwatchActionResult> => {
    let current = sessionRef.current;
    if (!current) return { status: 'ok', session: null };
    if (current.status === 'running') {
      const paused = await pause();
      if (paused.status === 'error' || !paused.session) return paused;
      current = paused.session;
    }
    const onLogged = () => {
      versionRef.current += 1;
      void runNow();
      notifyOtherTabs();
    };
    await launchLog({ session: current, span: getEntrySpan(current), onLogged });
    return { status: 'ok', session: current };
  }, [getEntrySpan, notifyOtherTabs, pause, runNow]);

  const requestDiscard = useCallback((): Promise<boolean> => {
    if (!sessionRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => setDialog({ kind: 'discard', resolve }));
  }, []);

  const startNow = useCallback(async (input: StopwatchStartInput): Promise<StopwatchStartResult> => {
    versionRef.current += 1;
    try {
      const result = await startStopwatch({
        work_item_type: input.workItemType,
        work_item_id: input.workItemId,
        service_id: input.serviceId ?? null,
        notes: input.notes,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        const message = getErrorMessage(result);
        toast.error(message);
        return { status: 'error', message };
      }
      const { conflict } = result as { conflict?: StopwatchSessionView };
      if (conflict) {
        apply(conflict);
        return { status: 'conflict', openSession: conflict };
      }
      const { session: started } = result as { session: StopwatchSessionView };
      apply(started);
      notifyOtherTabs();
      return { status: 'started', session: started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      return { status: 'error', message };
    }
  }, [apply, notifyOtherTabs]);

  const start = useCallback(async (
    input: StopwatchStartInput,
    launchLog?: StopwatchLogLauncher,
  ): Promise<StopwatchStartResult> => {
    const result = await startNow(input);
    if (result.status !== 'conflict') return result;
    return new Promise<StopwatchStartResult>((resolve) => {
      setDialog({ kind: 'conflict', input, launchLog, resolve });
    });
  }, [startNow]);

  const closeDialog = useCallback(() => {
    if (dialog?.kind === 'discard') dialog.resolve(false);
    if (dialog?.kind === 'conflict' && sessionRef.current) {
      dialog.resolve({ status: 'conflict', openSession: sessionRef.current });
    }
    setDialog(null);
  }, [dialog]);

  const confirmDiscard = useCallback(async () => {
    const current = sessionRef.current;
    const pending = dialog;
    if (!current || pending?.kind !== 'discard') return;
    const result = await mutate(() => discardStopwatch(current.session_id));
    setDialog(null);
    pending.resolve(result.status === 'ok');
  }, [dialog, mutate]);

  const chooseConflictResolution = useCallback(async (choice: StopwatchConflictChoice) => {
    const pending = dialog;
    const open = sessionRef.current;
    if (pending?.kind !== 'conflict' || !open) return;
    setDialog(null);

    if (choice === 'discard') {
      const discarded = await mutate(() => discardStopwatch(open.session_id));
      if (discarded.status === 'error') {
        pending.resolve({ status: 'conflict', openSession: open });
        return;
      }
      pending.resolve(await startNow(pending.input));
      return;
    }

    // Stop and log: the drawer decides when the session is logged. The new session starts only
    // after a successful save; cancelling the drawer leaves the open session paused.
    if (!pending.launchLog) {
      pending.resolve({ status: 'conflict', openSession: open });
      return;
    }
    const { input } = pending;
    await requestStop(({ session: toLog, span, onLogged }) =>
      pending.launchLog!({
        session: toLog,
        span,
        onLogged: () => {
          onLogged();
          void startNow(input);
        },
      }));
    pending.resolve({ status: 'conflict', openSession: sessionRef.current ?? open });
  }, [dialog, mutate, requestStop, startNow]);

  const state = !session ? 'idle' : session.status === 'running' ? 'running' : 'paused';

  const value = useMemo<StopwatchContextValue>(() => ({
    session,
    state,
    isLoading,
    serverOffsetMs,
    getElapsedMs,
    getEntrySpan,
    start,
    pause,
    resume,
    requestStop,
    requestDiscard,
    updateNotes,
    refresh: runNow,
  }), [
    session, state, isLoading, serverOffsetMs, getElapsedMs, getEntrySpan,
    start, pause, resume, requestStop, requestDiscard, updateNotes, runNow,
  ]);

  return (
    <StopwatchContextProvider value={value}>
      {children}
      {dialog?.kind === 'discard' ? (
        <StopwatchDiscardDialog
          session={session}
          elapsedMs={getElapsedMs()}
          onConfirm={confirmDiscard}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'conflict' ? (
        <StopwatchConflictDialog
          openSession={session}
          canLog={!!dialog.launchLog}
          elapsedMs={getElapsedMs()}
          onChoose={chooseConflictResolution}
          onClose={closeDialog}
        />
      ) : null}
    </StopwatchContextProvider>
  );
}
