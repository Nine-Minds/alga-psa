'use client';

import { useEffect, useState } from 'react';
import { getJobProgressAction, type JobProgressData } from '@alga-psa/jobs/actions';
import { getErrorMessage, isActionMessageError } from '@alga-psa/ui/lib/errorHandling';

export const useJobMonitor = (jobId: string) => {
  const [job, setJob] = useState<JobProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchJob = async () => {
      if (!jobId) {
        setJob(null);
        setError(null);
        return;
      }

      try {
        const jobProgress = await getJobProgressAction(jobId);
        if (isActionMessageError(jobProgress)) {
          if (isMounted) {
            setError(getErrorMessage(jobProgress));
            setJob(null);
          }
          return;
        }

        if (isMounted) {
          setJob(jobProgress);
          setError(null);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to fetch job:', error);
          setError('Failed to fetch job');
          setJob(null);
        }
      }
    };

    fetchJob();
    const interval = setInterval(fetchJob, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [jobId]);

  return { job, error };
};
