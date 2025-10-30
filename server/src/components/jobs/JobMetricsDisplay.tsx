import { Card } from 'server/src/components/ui/Card';
import { JobMetrics } from 'server/src/lib/actions/job-actions';
import { CheckCircle2, XCircle, Clock, ListChecks, Activity } from 'lucide-react';

interface JobMetricsDisplayProps {
  metrics: JobMetrics;
}

export default function JobMetricsDisplay({ metrics }: JobMetricsDisplayProps) {
  const successRate = metrics.total > 0
    ? Math.round((metrics.completed / metrics.total) * 100)
    : 0;

  const metricsData = [
    {
      id: 'total-jobs-metric',
      label: 'Total Jobs',
      value: metrics.total,
      icon: ListChecks,
      color: 'text-[rgb(var(--color-text-700))]',
      bgColor: 'bg-[rgb(var(--color-border-100))]',
      iconColor: 'text-[rgb(var(--color-text-600))]'
    },
    {
      id: 'completed-jobs-metric',
      label: 'Completed',
      value: metrics.completed,
      icon: CheckCircle2,
      color: 'text-[rgb(var(--color-primary-600))]',
      bgColor: 'bg-[rgb(var(--color-primary-50))]',
      iconColor: 'text-[rgb(var(--color-primary-500))]',
      subtext: `${successRate}% success rate`
    },
    {
      id: 'failed-jobs-metric',
      label: 'Failed',
      value: metrics.failed,
      icon: XCircle,
      color: 'text-[rgb(var(--color-accent-600))]',
      bgColor: 'bg-[rgb(var(--color-accent-50))]',
      iconColor: 'text-[rgb(var(--color-accent-500))]'
    },
    {
      id: 'pending-jobs-metric',
      label: 'Pending',
      value: metrics.pending,
      icon: Clock,
      color: 'text-[rgb(var(--color-secondary-600))]',
      bgColor: 'bg-[rgb(var(--color-secondary-50))]',
      iconColor: 'text-[rgb(var(--color-secondary-500))]'
    },
  ];

  const processingJobs = metrics.total - metrics.completed - metrics.failed - metrics.pending;
  if (processingJobs > 0) {
    metricsData.push({
      id: 'processing-jobs-metric',
      label: 'Processing',
      value: processingJobs,
      icon: Activity,
      color: 'text-[rgb(var(--color-secondary-600))]',
      bgColor: 'bg-[rgb(var(--color-secondary-50))]',
      iconColor: 'text-[rgb(var(--color-secondary-500))]'
    });
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {metricsData.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card
            key={metric.id}
            id={metric.id}
            className="p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                <Icon className={`h-5 w-5 ${metric.iconColor}`} />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-[rgb(var(--color-text-500))]">
                {metric.label}
              </p>
              <p className={`text-3xl font-bold ${metric.color}`}>
                {metric.value}
              </p>
              {metric.subtext && (
                <p className="text-xs text-[rgb(var(--color-text-400))] mt-1">
                  {metric.subtext}
                </p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
