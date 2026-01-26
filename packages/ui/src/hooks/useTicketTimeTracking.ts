'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { IntervalTrackingService, IntervalTrackingStateMachine } from '../services';

export function useTicketTimeTracking(
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  userId: string,
  options?: { autoStart?: boolean; holderId?: string }
) {
  const [currentIntervalId, setCurrentIntervalId] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isLockedByOther, setIsLockedByOther] = useState<boolean>(false);
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  const holderIdRef = useRef<string | undefined>(options?.holderId);
  const machineRef = useRef<IntervalTrackingStateMachine | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!ticketId || !userId) {
      console.log('[useTicketTimeTracking] skipping init: missing ids', { ticketId, userId });
      return;
    }
    console.log('[useTicketTimeTracking] init machine for ticket', ticketId, 'user', userId);
    (async () => {
      try {
        const removed = await intervalService.cleanupOrphanOpenIntervals();
        if (removed > 0) console.log('[useTicketTimeTracking] cleaned orphan open intervals:', removed);
        const trimmed = await intervalService.trimIntervalsForTicket(ticketId, 20);
        if (trimmed > 0)
          console.log('[useTicketTimeTracking] trimmed old intervals for ticket', ticketId, 'deleted:', trimmed);
      } catch {}
    })();
    const machine = new IntervalTrackingStateMachine(intervalService, {
      ticketId,
      ticketNumber,
      ticketTitle,
      userId,
      holderId: holderIdRef.current || '',
      heartbeatMs: 5000,
    });
    machineRef.current = machine;
    const unsub = machine.subscribe((snap) => {
      if (!mounted) return;
      console.log('[useTicketTimeTracking][subscribe] state=', snap.state, 'intervalId=', snap.intervalId);
      setIsTracking(snap.state === 'active');
      setCurrentIntervalId(snap.intervalId);
      setIsLockedByOther(snap.state === 'locked_by_other');
    });
    (async () => {
      const locked = await machine.refreshLockState();
      console.log('[useTicketTimeTracking] refreshLockState -> lockedByOther=', locked);
      if (options?.autoStart && !locked) {
        console.log('[useTicketTimeTracking] autoStart enabled; starting...');
        await machine.start(false);
      }
    })();
    return () => {
      mounted = false;
      console.log('[useTicketTimeTracking] cleanup; unsubscribing machine');
      unsub();
    };
  }, [ticketId, ticketNumber, ticketTitle, userId, intervalService, options?.autoStart]);

  const refreshLockState = async () => {
    console.log('[useTicketTimeTracking] refreshLockState() called');
    await machineRef.current?.refreshLockState();
  };

  const startTracking = async (force = false): Promise<boolean> => {
    console.log('[useTicketTimeTracking] startTracking(force=', force, ')');
    const res = await (machineRef.current?.start(force) ?? Promise.resolve(false));
    console.log('[useTicketTimeTracking] startTracking result ->', res);
    return res;
  };

  const stopTracking = async () => {
    console.log('[useTicketTimeTracking] stopTracking()');
    await machineRef.current?.stop();
  };

  return {
    isTracking,
    currentIntervalId,
    isLockedByOther,
    startTracking,
    stopTracking,
    refreshLockState,
  };
}

