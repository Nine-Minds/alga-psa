import { useState, useEffect, useMemo, useRef } from 'react';
import { IntervalTrackingService, IntervalTrackingStateMachine } from '../services/IntervalTrackingService';

/**
 * Custom hook to track time spent viewing a ticket
 * Records intervals in IndexedDB when a ticket is opened and closed
 */
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

  // Initialize state machine and optionally auto-start
  useEffect(() => {
    let mounted = true;
    if (!ticketId || !userId) return;
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
      setIsTracking(snap.state === 'active');
      setCurrentIntervalId(snap.intervalId);
      setIsLockedByOther(snap.state === 'locked_by_other');
    });
    (async () => {
      const locked = await machine.refreshLockState();
      if (options?.autoStart && !locked) {
        await machine.start(false);
      }
    })();
    return () => {
      mounted = false;
      unsub();
    };
  }, [ticketId, ticketNumber, ticketTitle, userId, intervalService, options?.autoStart]);
  // Note: We don't need to include isStartingTrackingRef in the dependency array
  // since it's a ref and we're accessing its .current property

  // Add event listeners for page visibility changes and beforeunload
  useEffect(() => {
    // Handle when user leaves the page or switches tabs
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        machineRef.current?.onHidden();
      } else if (document.visibilityState === 'visible') {
        // do nothing
      }
    };
    
    // Handle when user is about to close the page
    const handleBeforeUnload = () => {
      if (isTracking) {
        machineRef.current?.onBeforeUnloadSync();
      }
    };
    
    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Clean up event listeners
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentIntervalId, isTracking, ticketId, ticketNumber, ticketTitle, userId, intervalService]);
  
  const refreshLockState = async () => {
    await machineRef.current?.refreshLockState();
  };

  const startTracking = async (force = false): Promise<boolean> => {
    return machineRef.current?.start(force) ?? false;
  };

  const stopTracking = async () => {
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
