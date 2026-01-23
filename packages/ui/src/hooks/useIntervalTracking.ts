'use client';

import { useMemo, useState, useEffect } from 'react';
import { IntervalTrackingService } from '@alga-psa/ui/services';

export function useIntervalTracking(userId?: string) {
  const [intervalCount, setIntervalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const intervalService = useMemo(() => new IntervalTrackingService(), []);

  useEffect(() => {
    let mounted = true;

    const fetchIntervalCount = async () => {
      if (!userId) return;

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

    fetchIntervalCount();

    const intervalId = setInterval(fetchIntervalCount, 60000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userId, intervalService]);

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
    intervalService,
  };
}

