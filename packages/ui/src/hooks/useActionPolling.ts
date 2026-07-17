'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  isStaleServerActionError,
  markStaleActionState,
} from '../lib/staleActionState';

interface ActionPollingOptions {
  intervalMs: number;
  enabled?: boolean;
  runImmediately?: boolean;
  maxBackoffMs?: number;
  onError?: (error: unknown, retryDelayMs: number) => void;
}

interface ActionPollingResult {
  runNow: () => Promise<void>;
}

type PollAttemptResult =
  | { outcome: 'success' }
  | { outcome: 'retry'; retryDelayMs: number }
  | { outcome: 'halted' };

export function useActionPolling(
  action: () => Promise<unknown> | unknown,
  {
    intervalMs,
    enabled = true,
    runImmediately = true,
    maxBackoffMs = intervalMs * 16,
    onError,
  }: ActionPollingOptions,
): ActionPollingResult {
  const actionRef = useRef(action);
  const onErrorRef = useRef(onError);
  const intervalMsRef = useRef(intervalMs);
  const maxBackoffMsRef = useRef(maxBackoffMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<PollAttemptResult> | null>(null);
  const failureCountRef = useRef(0);
  const haltedRef = useRef(false);

  actionRef.current = action;
  onErrorRef.current = onError;
  intervalMsRef.current = intervalMs;
  maxBackoffMsRef.current = maxBackoffMs;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const executeAction = useCallback((): Promise<PollAttemptResult> => {
    if (haltedRef.current) {
      return Promise.resolve({ outcome: 'halted' });
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const attempt = (async (): Promise<PollAttemptResult> => {
      try {
        await actionRef.current();
        failureCountRef.current = 0;
        return { outcome: 'success' };
      } catch (error) {
        if (isStaleServerActionError(error)) {
          haltedRef.current = true;
          clearTimer();
          markStaleActionState();
          return { outcome: 'halted' };
        }

        failureCountRef.current += 1;
        const backoffExponent = Math.min(failureCountRef.current - 1, 30);
        const retryDelayMs = Math.min(
          intervalMsRef.current * (2 ** backoffExponent),
          maxBackoffMsRef.current,
        );

        console.error(
          `[useActionPolling] Action failed; retrying in ${retryDelayMs}ms`,
          error,
        );
        onErrorRef.current?.(error, retryDelayMs);

        return { outcome: 'retry', retryDelayMs };
      }
    })();

    inFlightRef.current = attempt;
    void attempt.finally(() => {
      if (inFlightRef.current === attempt) {
        inFlightRef.current = null;
      }
    });

    return attempt;
  }, [clearTimer]);

  const runNow = useCallback(async () => {
    await executeAction();
  }, [executeAction]);

  useEffect(() => {
    clearTimer();

    if (!enabled || haltedRef.current) {
      return undefined;
    }

    let cancelled = false;

    const schedule = (delayMs: number) => {
      if (cancelled || haltedRef.current) {
        return;
      }

      timerRef.current = setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      const result = await executeAction();
      if (cancelled || result.outcome === 'halted') {
        return;
      }

      schedule(
        result.outcome === 'retry'
          ? result.retryDelayMs
          : intervalMsRef.current,
      );
    };

    if (runImmediately) {
      void poll();
    } else {
      schedule(intervalMs);
    }

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [clearTimer, enabled, executeAction, intervalMs, maxBackoffMs, runImmediately]);

  return { runNow };
}
