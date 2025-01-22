import { useEffect, useState } from 'react';
import { JobService } from '@/services/job.service';
import { getAdminConnection } from '@/lib/db/admin';
import type { JobHeader, JobDetail, JobMetrics } from '@/services/job.service';

export const useJobMonitor = (jobId: string) => {
  const [jobService, setJobService] = useState<JobService | null>(null);

  useEffect(() => {
    const initializeService = async () => {
      const connection = await getAdminConnection();
      setJobService(new JobService(connection));
    };
    initializeService();
  }, []);

  if (!jobService) {
    return { header: null, details: [], metrics: null };
  }
  const [header, setHeader] = useState<JobHeader | null>(null);
  const [details, setDetails] = useState<JobDetail[]>([]);
  const [metrics, setMetrics] = useState<JobMetrics | null>(null);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const progress = await jobService.getJobProgress(jobId);
        setHeader(progress.header);
        setDetails(progress.details);
        setMetrics(progress.metrics);
      } catch (error) {
        console.error('Failed to fetch job progress:', error);
      }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);

    return () => clearInterval(interval);
  }, [jobId]);

  return { header, details, metrics };
};