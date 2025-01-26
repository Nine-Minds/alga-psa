import { Card } from '@/components/ui/Card';
import { JobMetrics } from '@/lib/actions/job-actions';

interface JobMetricsDisplayProps {
  metrics: JobMetrics;
}

export default function JobMetricsDisplay({ metrics }: JobMetricsDisplayProps) {

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Job Metrics</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="text-center p-4 bg-gray-50 rounded-lg">
          <div className="text-sm font-medium text-gray-500 mb-2">Total</div>
          <div className="text-2xl font-bold text-gray-900">
            {metrics.total}
          </div>
        </div>
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <div className="text-sm font-medium text-green-600 mb-2">Completed</div>
          <div className="text-2xl font-bold text-green-700">
            {metrics.completed}
          </div>
        </div>
        <div className="text-center p-4 bg-red-50 rounded-lg">
          <div className="text-sm font-medium text-red-600 mb-2">Failed</div>
          <div className="text-2xl font-bold text-red-700">
            {metrics.failed}
          </div>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded-lg">
          <div className="text-sm font-medium text-gray-600 mb-2">Pending</div>
          <div className="text-2xl font-bold text-gray-700">
            {metrics.pending}
          </div>
        </div>
      </div>
    </Card>
  );
}