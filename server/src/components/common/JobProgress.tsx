import { useJobMonitor } from '@/lib/hooks/useJobMonitor';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { formatDistanceToNow } from 'date-fns';

interface JobProgressProps {
  jobId: string;
}

interface JobDetail {
  id: string;
  stepName: string;
  status: string;
  processedAt?: Date;
  result?: Record<string, unknown>;
}

export const JobProgress = ({ jobId }: JobProgressProps) => {
  const { header, details } = useJobMonitor(jobId);

  const getStatusColor = (status: string): BadgeVariant => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'processing':
        return 'primary';
      default:
        return 'default';
    }
  };

  return (
    <Card className="p-4 space-y-4">
      {header && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">{header.type}</h3>
          <Badge variant={getStatusColor(header.status)}>
            {header.status}
          </Badge>
        </div>
      )}

      <div className="space-y-2">
        {details.map((step: JobDetail) => (
          <div key={step.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm">{step.stepName}</span>
              <Badge variant={getStatusColor(step.status)}>
                {step.status}
              </Badge>
            </div>
            {step.processedAt && (
              <div className="text-xs text-gray-500">
                {formatDistanceToNow(new Date(step.processedAt))} ago
              </div>
            )}
            {step.result && (
              <pre className="text-xs text-gray-600 mt-1">
                {JSON.stringify(step.result, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};