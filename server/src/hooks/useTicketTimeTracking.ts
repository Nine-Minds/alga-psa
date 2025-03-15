import { useState, useEffect, useMemo } from 'react';
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
  
  // Start tracking when component mounts
  useEffect(() => {
    let mounted = true;
    let intervalIdRef = currentIntervalId;
    
    const startTracking = async () => {
      try {
        // Only track if we have valid ticket info
        if (!ticketId || !ticketNumber || !userId) {
          console.debug('Not starting tracking due to missing ticket info');
          return;
        }
        
        // Check if there's an existing open interval for this ticket
        const existingInterval = await intervalService.getOpenInterval(ticketId, userId);
        
        if (existingInterval) {
          // If there's an existing open interval, use it for the current session
          console.debug('Found existing open interval for this ticket, using it for current session');
          if (mounted) {
            setCurrentIntervalId(existingInterval.id);
            intervalIdRef = existingInterval.id;
            setIsTracking(true);
          }
        } else {
          // Check if there are any previous intervals for this ticket today
          const ticketIntervals = await intervalService.getIntervalsByTicket(ticketId);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const todaysIntervals = ticketIntervals.filter(interval => {
            const intervalDate = new Date(interval.startTime);
            intervalDate.setHours(0, 0, 0, 0);
            return intervalDate.getTime() === today.getTime();
          }).sort((a, b) => new Date(b.endTime || '').getTime() - new Date(a.endTime || '').getTime());
          
          // Start a new interval
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
      } catch (error) {
        console.error('Error starting interval tracking:', error);
      }
    };
    
    startTracking();
    
    // End tracking when component unmounts
    return () => {
      mounted = false;
      
      // Use the ref to ensure we have the latest interval ID
      if (intervalIdRef) {
        console.debug('Ending interval on component unmount:', intervalIdRef);
        // End the current interval
        intervalService.endInterval(intervalIdRef).catch(error => {
          console.error('Error ending interval:', error);
        });
        
        // Check if we should create a new interval starting from the end time of this one
        // This will be handled in the next ticket view
        const checkForContinuousTracking = async () => {
          try {
            const ticketIntervals = await intervalService.getIntervalsByTicket(ticketId);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Find the most recent interval for this ticket today
            const todaysIntervals = ticketIntervals.filter(interval => {
              const intervalDate = new Date(interval.startTime);
              intervalDate.setHours(0, 0, 0, 0);
              return intervalDate.getTime() === today.getTime();
            }).sort((a, b) => new Date(b.endTime || '').getTime() - new Date(a.endTime || '').getTime());
            
            // Store the end time of the current interval in localStorage
            // This will be used when the ticket is opened again
            if (todaysIntervals.length > 0 && todaysIntervals[0].endTime) {
              localStorage.setItem(`lastTicketEndTime_${ticketId}`, todaysIntervals[0].endTime);
            }
          } catch (error) {
            console.error('Error checking for continuous tracking:', error);
          }
        };
        
        checkForContinuousTracking();
      }
    };
  }, [ticketId, ticketNumber, ticketTitle, userId, intervalService]);

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