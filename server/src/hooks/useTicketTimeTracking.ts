import { useState, useEffect, useMemo, useRef } from 'react';
import { IntervalTrackingService } from '../services/IntervalTrackingService';

/**
 * Custom hook to track time spent viewing a ticket
 * Records intervals in IndexedDB when a ticket is opened and closed
 * Maintains continuous tracking during the entire session, even when switching tabs or windows
 * Stops tracking when navigating away from the ticket entirely
 */
export function useTicketTimeTracking(
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  userId: string
) {
  const [currentIntervalId, setCurrentIntervalId] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  
  // Ref to track if a startTracking operation is in progress to prevent race conditions
  const isStartingTrackingRef = useRef(false);
  
  // Ref to track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  
  // Start tracking when component mounts
  useEffect(() => {
    let mounted = true;
    let intervalIdRef = currentIntervalId;
    
    const startTracking = async () => {
      // If already starting tracking, skip this call to prevent race conditions
      if (isStartingTrackingRef.current) {
        console.debug('Skipping startTracking call - operation already in progress');
        return;
      }
      
      // Set flag to indicate tracking is starting
      isStartingTrackingRef.current = true;
      
      try {
        // Only track if we have valid ticket info
        if (!ticketId || !ticketNumber || !userId) {
          console.debug('Not starting tracking due to missing ticket info');
          isStartingTrackingRef.current = false;
          return;
        }
        
        console.debug('Checking for existing open interval for ticket:', ticketId);
        
        // Check if there's an existing open interval for this ticket
        const existingInterval = await intervalService.getOpenInterval(ticketId, userId);
        
        if (existingInterval) {
          // If there's an existing open interval, use it for the current session
          console.debug('Found existing open interval for this ticket, using it for current session:', existingInterval.id);
          if (mounted) {
            setCurrentIntervalId(existingInterval.id);
            intervalIdRef = existingInterval.id;
            setIsTracking(true);
          }
        } else {
          console.debug('No existing open interval found, creating a new one');
          
          // Check if there are any previous intervals for this ticket today
          const ticketIntervals = await intervalService.getIntervalsByTicket(ticketId);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const todaysIntervals = ticketIntervals.filter(interval => {
            const intervalDate = new Date(interval.startTime);
            intervalDate.setHours(0, 0, 0, 0);
            return intervalDate.getTime() === today.getTime();
          }).sort((a, b) => new Date(b.endTime || '').getTime() - new Date(a.endTime || '').getTime());
          
          // Double-check for an open interval again before creating a new one
          // This helps prevent race conditions where another call might have created an interval
          const doubleCheckInterval = await intervalService.getOpenInterval(ticketId, userId);
          
          if (doubleCheckInterval) {
            console.debug('Found open interval on double-check, using it:', doubleCheckInterval.id);
            if (mounted) {
              setCurrentIntervalId(doubleCheckInterval.id);
              intervalIdRef = doubleCheckInterval.id;
              setIsTracking(true);
            }
          } else {
            // Start a new interval
            console.debug('Creating new interval for ticket:', ticketId);
            const intervalId = await intervalService.startInterval(
              ticketId,
              ticketNumber,
              ticketTitle,
              userId
            );
            
            if (mounted) {
              setCurrentIntervalId(intervalId);
              intervalIdRef = intervalId;
              setIsTracking(true);
            }
          }
        }
      } catch (error) {
        console.error('Error starting interval tracking:', error);
      } finally {
        // Reset flag when done
        isStartingTrackingRef.current = false;
      }
    };
    
    startTracking();
    
    // Handle component unmount - now properly closes intervals when leaving the ticket
    return () => {
      mounted = false;
      isMountedRef.current = false;
      
      // Close the current interval when the component unmounts (user navigates away from ticket)
      if (intervalIdRef) {
        console.debug('Closing interval on component unmount:', intervalIdRef);
        intervalService.endInterval(intervalIdRef).catch(error => {
          console.error('Error closing interval on unmount:', error);
        });
      }
    };
  }, [ticketId, ticketNumber, ticketTitle, userId, intervalService]);
  // Note: We don't need to include isStartingTrackingRef in the dependency array
  // since it's a ref and we're accessing its .current property

  // Add event listeners for page visibility changes and beforeunload
  useEffect(() => {
    // Handle when user switches tabs or minimizes window - but keep tracking continuously
    const handleVisibilityChange = () => {
      // We no longer end intervals when switching tabs or windows
      // This ensures continuous time tracking for the entire session
      // The interval will only be closed when the user navigates away from the ticket entirely
      
      if (document.visibilityState === 'visible' && !isTracking && ticketId && isMountedRef.current) {
        // User has returned to the tab and we need to resume tracking if not already tracking
        console.debug('Tab became visible, checking if we need to resume tracking');
        
        // Check if there's an existing open interval for this ticket
        intervalService.getOpenInterval(ticketId, userId)
          .then(existingInterval => {
            if (existingInterval && isMountedRef.current) {
              console.debug('Found existing interval when tab became visible, resuming tracking');
              setCurrentIntervalId(existingInterval.id);
              setIsTracking(true);
            } else if (isMountedRef.current) {
              // No existing interval, start a new one
              console.debug('No existing interval found, starting new one on tab visibility');
              return intervalService.startInterval(ticketId, ticketNumber, ticketTitle, userId);
            }
          })
          .then(intervalId => {
            if (intervalId && isMountedRef.current) {
              setCurrentIntervalId(intervalId);
              setIsTracking(true);
            }
          })
          .catch(error => {
            console.error('Error handling visibility change:', error);
          });
      }
    };
    
    // Handle when user is about to close the page
    const handleBeforeUnload = () => {
      if (currentIntervalId && isTracking) {
        // We use a synchronous approach here since beforeunload doesn't wait for promises
        try {
          const request = window.indexedDB.open(
            'TicketTimeTrackingDB',
            1
          );
          
          request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = db.transaction(['intervals'], 'readwrite');
            const objectStore = transaction.objectStore('intervals');
            
            // Get the interval to update
            const getRequest = objectStore.get(currentIntervalId);
            
            getRequest.onsuccess = (event) => {
              const interval = (event.target as IDBRequest).result;
              
              if (interval) {
                const endTime = new Date().toISOString();
                const startDate = new Date(interval.startTime);
                const endDate = new Date(endTime);
                const duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
                
                interval.endTime = endTime;
                interval.duration = duration;
                
                objectStore.put(interval);
              }
            };
          };
        } catch (error) {
          console.error('Error in beforeunload handler:', error);
        }
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
  
  // Function to get current elapsed time for an open interval
  const getCurrentElapsedTime = async (): Promise<number> => {
    if (!currentIntervalId || !ticketId || !userId) return 0;
    
    try {
      const openInterval = await intervalService.getOpenInterval(ticketId, userId);
      if (openInterval && openInterval.startTime) {
        const start = new Date(openInterval.startTime);
        return Math.floor((Date.now() - start.getTime()) / 1000);
      }
    } catch (error) {
      console.error('Error getting current elapsed time:', error);
    }
    
    return 0;
  };

  return {
    isTracking,
    currentIntervalId,
    getCurrentElapsedTime,
  };
}