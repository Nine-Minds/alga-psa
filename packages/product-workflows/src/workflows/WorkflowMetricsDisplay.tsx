import { Card } from '@server/components/ui/Card';
import { WorkflowMetrics } from '@server/lib/actions/workflow-actions';

interface WorkflowMetricsDisplayProps {
  metrics: WorkflowMetrics;
}

export default function WorkflowMetricsDisplay({ metrics }: WorkflowMetricsDisplayProps) {
  return (
    <Card className="p-6">
      <h3 className="text-2xl font-semibold text-[rgb(var(--color-text-900))] mb-6">
        Workflow Metrics
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
            Active
          </div>
          <div className="text-2xl font-bold text-[rgb(var(--color-text-900))]">
            {metrics.active}
          </div>
        </div>
      </div>
      
      {/* Workflow Type Breakdown */}
      {Object.keys(metrics.byWorkflowName).length > 0 && (
        <div className="mt-6">
          <h4 className="text-lg font-semibold text-[rgb(var(--color-text-800))] mb-4">
            Workflows by Type
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(metrics.byWorkflowName).map(([name, count]) => (
              <div 
                key={name}
                className="flex justify-between items-center p-3 rounded-lg border border-[rgb(var(--color-border-200))]"
              >
                <span className="font-medium text-[rgb(var(--color-text-700))]">
                  {name}
                </span>
                <span className="text-[rgb(var(--color-text-900))] font-semibold">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}