import { useState, useEffect, useMemo, useRef } from 'react';
import { IntervalTrackingService } from '../services/IntervalTrackingService';

/**
 * Custom hook to track time spent viewing a ticket
 * Records intervals in IndexedDB when a ticket is opened and closed
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
    
    // End tracking when component unmounts
    return () => {
      mounted = false;
      // We no longer close intervals on component unmount to avoid timing issues
      // Interval closing is now handled by navigation controls before route changes
    };
  }, [ticketId, ticketNumber, ticketTitle, userId, intervalService]);
  // Note: We don't need to include isStartingTrackingRef in the dependency array
  // since it's a ref and we're accessing its .current property

  // Add event listeners for page visibility changes and beforeunload
  useEffect(() => {
    // Handle when user leaves the page or switches tabs
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && currentIntervalId && isTracking) {
        // User has switched tabs or minimized the window
        intervalService.endInterval(currentIntervalId).catch(error => {
          console.error('Error ending interval on visibility change:', error);
        });
        setIsTracking(false);
      } else if (document.visibilityState === 'visible' && !isTracking && ticketId) {
        // User has returned to the tab
        intervalService.startInterval(ticketId, ticketNumber, ticketTitle, userId)
          .then(intervalId => {
            setCurrentIntervalId(intervalId);
            setIsTracking(true);
          })
          .catch(error => {
            console.error('Error restarting interval on visibility change:', error);
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
  
  return {
    isTracking,
    currentIntervalId,
  };
}