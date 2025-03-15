import { useMemo, useState, useEffect } from 'react';
import { IntervalTrackingService } from '../services/IntervalTrackingService';

/**
 * Hook for interval tracking functionality across the application
 */
export function useIntervalTracking(userId?: string) {
  const [intervalCount, setIntervalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  
  // Fetch interval count periodically
  useEffect(() => {
    if (!userId) return;
    
    let mounted = true;
    
    const fetchIntervalCount = async () => {
      try {
        setIsLoading(true);
        const count = await intervalService.getOpenIntervalCount(userId);
        if (mounted) {
          setIntervalCount(count);
        }
      } catch (error) {
        console.error('Error fetching interval count:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    // Fetch immediately
    fetchIntervalCount();
    
    // Set up interval for periodic updates
    const intervalId = setInterval(fetchIntervalCount, 60000); // Update every minute
    
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userId, intervalService]);
  
  // Get total and open interval counts for a user
  const getIntervalCount = async (targetUserId?: string) => {
    if (!targetUserId && !userId) return 0;
    
    try {
      return await intervalService.getOpenIntervalCount(targetUserId || userId || '');
    } catch (error) {
      console.error('Error getting interval count:', error);
      return 0;
    }
  };
  
  return {
    intervalCount,
    isLoading,
    getIntervalCount,
    intervalService
  };
}