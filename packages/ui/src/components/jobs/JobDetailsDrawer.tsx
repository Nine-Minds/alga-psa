import React from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { JobProgress } from 'server/src/components/common/JobProgress';
import JobMetricsDisplay from './JobMetricsDisplay';
import { useJobMonitor } from 'server/src/lib/hooks/useJobMonitor';
import JobStepHistory from './JobStepHistory';

interface JobDetailsDrawerProps {
  jobId: string | null;
  onClose: () => void;
}

const JobDetailsDrawer: React.FC<JobDetailsDrawerProps> = ({ jobId, onClose }) => {
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
              <h2 className="text-xl font-semibold">Job Details</h2>
              <div className="text-sm text-gray-500">ID: {jobId}</div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Job Progress</h3>
                <JobProgress jobId={jobId} />
              </div>
              
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Job Metrics</h3>
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
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Job History</h3>
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
