import { JobState } from '@/lib/jobs/jobScheduler';
import { Card } from '@/components/ui/Card';

interface JobMetricsDisplayProps {
  metrics: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    active: number;
    queued: number;
  };
}

export default function JobMetricsDisplay({
  metrics
}: JobMetricsDisplayProps) {

  return (
    <Card>
      <div className="grid grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-sm font-medium">Total</div>
          <div className="text-2xl font-bold">
            {metrics?.total || 0}
          </div>
        </div>
        
        <div className="text-center">
          <div className="text-sm font-medium">Active</div>
          <div className="text-2xl font-bold">
            {metrics?.active || 0}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm font-medium">Queued</div>
          <div className="text-2xl font-bold">
            {metrics?.queued || 0}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm font-medium">Completed</div>
          <div className="text-2xl font-bold">
            {metrics?.completed || 0}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm font-medium">Failed</div>
          <div className="text-2xl font-bold">
            {metrics?.failed || 0}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm font-medium">Pending</div>
          <div className="text-2xl font-bold">
            {metrics?.pending || 0}
          </div>
        </div>
      </div>
    </Card>
  );
}