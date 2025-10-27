import { Card } from 'server/src/components/ui/Card';
import { JobMetrics } from '@product/actions/job-actions';

interface JobMetricsDisplayProps {
  metrics: JobMetrics;
}

export default function JobMetricsDisplay({ metrics }: JobMetricsDisplayProps) {

  return (
    <Card className="p-6">
      <h3 className="text-2xl font-semibold text-[rgb(var(--color-text-900))] mb-6">
        Job Metrics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-4 rounded-lg border border-[rgb(var(--color-border-200))]">
          <div className="text-sm font-medium text-[rgb(var(--color-text-500))] mb-2">
            Total
          </div>
          <div className="text-2xl font-bold text-[rgb(var(--color-text-900))]">
            {metrics.total}
          </div>
        </div>
        <div className="text-center p-4 rounded-lg border border-[rgb(var(--color-border-200))]">
          <div className="text-sm font-medium text-[rgb(var(--color-primary-500))] mb-2">
            Completed
          </div>
          <div className="text-2xl font-bold text-[rgb(var(--color-primary-600))]">
            {metrics.completed}
          </div>
        </div>
        <div className="text-center p-4 rounded-lg border border-[rgb(var(--color-border-200))]">
          <div className="text-sm font-medium text-[rgb(var(--color-accent-500))] mb-2">
            Failed
          </div>
          <div className="text-2xl font-bold text-[rgb(var(--color-accent-600))]">
            {metrics.failed}
          </div>
        </div>
        <div className="text-center p-4 rounded-lg border border-[rgb(var(--color-border-200))]">
          <div className="text-sm font-medium text-[rgb(var(--color-text-500))] mb-2">
            Pending
          </div>
          <div className="text-2xl font-bold text-[rgb(var(--color-text-900))]">
            {metrics.pending}
          </div>
        </div>
      </div>
    </Card>
  );
}
