import { useJobMonitor } from '@/lib/hooks/useJobMonitor';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { formatDistanceToNow } from 'date-fns';

interface JobProgressProps {
  jobId: string;
}

export const JobProgress = ({ jobId }: JobProgressProps) => {
  const { job, error } = useJobMonitor(jobId);

  const getStatusColor = (status: string): BadgeVariant => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'pending':
        return 'primary';
      default:
        return 'default';
    }
  };

  if (error) {
    return (
      <Card className="p-4">
        <div className="text-[rgb(var(--color-accent-600))]">{error}</div>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card className="p-4">
        <div className="text-[rgb(var(--color-text-500))]">Loading job details...</div>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {job.header.type}
        </h3>
        <div className={`text-sm font-medium px-2 py-1 rounded ${
          job.header.status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
          job.header.status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' : 
          'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
        }`}>
          {job.header.status.charAt(0).toUpperCase() + job.header.status.slice(1)}
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm text-[rgb(var(--color-text-600))]">
          <div className="space-y-1">
            <span className="font-medium">Created:</span>
            <div className="text-[rgb(var(--color-text-500))]">
              {formatDistanceToNow(job.header.createdAt)} ago
            </div>
          </div>
        </div>

        {job.header.metadata && Object.keys(job.header.metadata).length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              Job Data
            </h4>
            <div className="border border-[rgb(var(--color-border-200))] rounded-lg overflow-hidden">
              <pre className="text-xs text-[rgb(var(--color-text-600))] bg-[rgb(var(--color-border-50))] p-3 overflow-auto max-h-[200px]">
                {JSON.stringify(job.header.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
