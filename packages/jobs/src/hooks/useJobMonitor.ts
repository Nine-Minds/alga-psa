'use client';

import { useEffect, useState } from 'react';
import { getJobProgressAction, type JobProgressData } from '@alga-psa/jobs/actions';

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
        if (isMounted) {
          setJob(jobProgress);
          setError(null);
        }
      } catch (error) {
        if (isMounted) {
          setError(error instanceof Error ? error.message : 'Failed to fetch job');
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

