'use client';

import React from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { JobProgress } from './JobProgress';
import JobMetricsDisplay from './JobMetricsDisplay';
import { useJobMonitor } from '@alga-psa/jobs/hooks';
import JobStepHistory from './JobStepHistory';

interface JobDetailsDrawerProps {
  jobId: string | null;
  onClose: () => void;
}

const JobDetailsDrawer: React.FC<JobDetailsDrawerProps> = ({ jobId, onClose }) => {
  const { t } = useTranslation('msp/jobs');
  const { job, error } = useJobMonitor(jobId || '');

  return (
    <Drawer
      isOpen={!!jobId}
      onClose={onClose}
      id="job-details-drawer"
    >
      <div className="min-w-[600px] max-w-[800px]" style={{ zIndex: 1000 }}>
        {jobId && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('drawer.title', { defaultValue: 'Job Details' })}</h2>
              <div className="text-sm text-gray-500">
                {t('drawer.jobId', { defaultValue: 'ID: {{id}}', id: jobId })}
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('drawer.sections.progress', { defaultValue: 'Job Progress' })}</h3>
                <JobProgress jobId={jobId} />
              </div>
              
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('drawer.sections.metrics', { defaultValue: 'Job Metrics' })}</h3>
                <JobMetricsDisplay metrics={job?.metrics || {
                  total: 0,
                  completed: 0,
                  failed: 0,
                  pending: 0,
                  active: 0,
                  queued: 0,
                  byRunner: {
                    pgboss: 0,
                    temporal: 0
                  }
                }} />
              </div>
              
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('drawer.sections.history', { defaultValue: 'Job History' })}</h3>
                <JobStepHistory steps={job?.details || []} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default JobDetailsDrawer;
