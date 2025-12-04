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

  const isMixedRunners = metrics.byRunner && metrics.byRunner.pgboss > 0 && metrics.byRunner.temporal > 0;
  
  let totalLabel = 'Total Jobs';
  if (metrics.byRunner && !isMixedRunners) {
    if (metrics.byRunner.pgboss > 0) totalLabel = 'Total Jobs (PG Boss)';
    if (metrics.byRunner.temporal > 0) totalLabel = 'Total Jobs (Temporal)';
  }

  const metricsData = [
    {
      id: 'total-jobs-metric',
      label: totalLabel,
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

  if (metrics.byRunner && isMixedRunners) {
    if (metrics.byRunner.pgboss > 0) {
      metricsData.push({
        id: 'pgboss-metric',
        label: 'PG Boss',
        value: metrics.byRunner.pgboss,
        icon: ListChecks,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        iconColor: 'text-blue-500'
      });
    }

    if (metrics.byRunner.temporal > 0) {
      metricsData.push({
        id: 'temporal-metric',
        label: 'Temporal',
        value: metrics.byRunner.temporal,
        icon: Activity,
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        iconColor: 'text-purple-500'
      });
    }
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
